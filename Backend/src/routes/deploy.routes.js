import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import express from 'express';

import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Deploy webhook.
 *
 * This endpoint runs a shell script on the host, so it is the most dangerous
 * route in the app and is treated accordingly:
 *
 *  - It is not mounted at all unless DEPLOY_WEBHOOK_ENABLED=true and a secret of
 *    at least MIN_SECRET_LENGTH chars is configured. The previous version carried
 *    a hardcoded 'mysecret123' in server.js, which is to say it published remote
 *    code execution to anyone who could read the repository.
 *  - The signature is verified against the raw request bytes with a constant-time
 *    comparison. The old check hashed JSON.stringify(req.body), which is a
 *    different byte string than the sender signed and so could not have matched a
 *    real GitHub delivery.
 *  - The script is invoked directly via execFile, never through a shell, and the
 *    path comes from configuration rather than from the request.
 *  - One deploy at a time, enforced with an atomic lock directory so the guard
 *    holds across PM2 cluster workers (which each run their own copy of this
 *    module and cannot see each other's memory).
 */

const MIN_SECRET_LENGTH = 32;
const SIGNATURE_HEADER = 'x-hub-signature-256';
const LOCK_DIR = path.resolve(process.cwd(), '.deploy.lock');
/** A lock older than this is assumed to be from a crashed run and is reclaimed. */
const LOCK_STALE_MS = 30 * 60 * 1000;

const router = express.Router();

/**
 * Compares two signature strings without leaking where they differ.
 *
 * timingSafeEqual throws on a length mismatch, so that is checked first — the
 * length of a signature is not a secret.
 */
const signaturesMatch = (received, expected) => {
    const a = Buffer.from(String(received || ''), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
};

/**
 * Takes the deploy lock, or reports who holds it.
 *
 * mkdir is atomic on every platform we run on, which makes it a usable mutex
 * between processes without requiring Redis to be up.
 */
const acquireLock = () => {
    try {
        fs.mkdirSync(LOCK_DIR);
        return { acquired: true };
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;

        let heldForMs = 0;
        try {
            heldForMs = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
        } catch {
            // Vanished between mkdir and stat — another worker just released it.
            return { acquired: false, heldForMs: 0 };
        }

        if (heldForMs > LOCK_STALE_MS) {
            logger.warn(`Deploy lock is ${Math.round(heldForMs / 60000)}m old, reclaiming it`);
            releaseLock();
            try {
                fs.mkdirSync(LOCK_DIR);
                return { acquired: true };
            } catch {
                return { acquired: false, heldForMs };
            }
        }

        return { acquired: false, heldForMs };
    }
};

const releaseLock = () => {
    try {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch (err) {
        logger.error(`Failed to release deploy lock: ${err.message}`);
    }
};

const handleDeploy = (req, res) => {
    // rawBody is captured in app.js for this path. Its absence means the request
    // was not JSON, so there is nothing that could have been signed.
    if (!req.rawBody) {
        logger.warn('Deploy webhook rejected: no raw body to verify');
        return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const expected = 'sha256=' + crypto
        .createHmac('sha256', config.deployWebhookSecret)
        .update(req.rawBody)
        .digest('hex');

    if (!signaturesMatch(req.headers[SIGNATURE_HEADER], expected)) {
        // Deliberately vague, and logged without the presented signature.
        logger.warn('Deploy webhook rejected: signature mismatch');
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    let lock;
    try {
        lock = acquireLock();
    } catch (err) {
        logger.error(`Deploy lock error: ${err.message}`);
        return res.status(500).json({ success: false, message: 'Deploy failed to start' });
    }

    if (!lock.acquired) {
        logger.info('Deploy webhook rejected: a deploy is already running');
        return res.status(409).json({ success: false, message: 'A deploy is already running' });
    }

    logger.info(`Deploy webhook accepted, running ${config.deployScriptPath}`);

    // execFile can fail either way: asynchronously through the callback, or by
    // throwing right here when the OS cannot spawn the file at all (not
    // executable, not a format this platform can run). The throw has to be
    // caught, because an escaping exception would leave the lock held and block
    // every later deploy until the stale timeout reclaimed it.
    try {
        execFile(
            config.deployScriptPath,
            [],
            {
                cwd: path.dirname(config.deployScriptPath),
                timeout: config.deployTimeoutMs,
                maxBuffer: 10 * 1024 * 1024,
                shell: false,
            },
            (err, stdout, stderr) => {
                releaseLock();

                if (err) {
                    logger.error(`Deploy script failed: ${err.message}`);
                    if (stderr) logger.error(`Deploy stderr: ${String(stderr).slice(0, 4000)}`);
                    return;
                }

                logger.info(`Deploy script completed: ${String(stdout).slice(0, 4000)}`);
            }
        );
    } catch (err) {
        releaseLock();
        logger.error(`Deploy script could not be started: ${err.message}`);
        return res.status(500).json({ success: false, message: 'Deploy failed to start' });
    }

    // Answer immediately rather than holding the connection for the length of a
    // deploy: the script may restart this very process, and the sender's delivery
    // timeout is far shorter than a build. Progress belongs in the logs.
    return res.status(202).json({ success: true, message: 'Deploy started' });
};

/**
 * Mounts the webhook only when it is fully configured, and explains in the log
 * why it is absent otherwise — a silently missing deploy hook is worse to debug
 * than one that says what it wants.
 *
 * @returns {boolean} whether the route was mounted
 */
export const isDeployWebhookConfigured = () => {
    if (!config.deployWebhookEnabled) {
        logger.info('Deploy webhook disabled (set DEPLOY_WEBHOOK_ENABLED=true to enable).');
        return false;
    }
    if (!config.deployWebhookSecret || config.deployWebhookSecret.length < MIN_SECRET_LENGTH) {
        logger.error(
            `Deploy webhook NOT mounted: DEPLOY_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`
        );
        return false;
    }
    if (!config.deployScriptPath || !path.isAbsolute(config.deployScriptPath)) {
        logger.error('Deploy webhook NOT mounted: DEPLOY_SCRIPT_PATH must be an absolute path.');
        return false;
    }
    if (!fs.existsSync(config.deployScriptPath)) {
        logger.error(`Deploy webhook NOT mounted: no script at ${config.deployScriptPath}`);
        return false;
    }
    return true;
};

router.post('/', handleDeploy);

export default router;
