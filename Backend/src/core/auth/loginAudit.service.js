import { FoodLoginAudit } from './loginAudit.model.js';
import { logger } from '../../utils/logger.js';

/**
 * Records successful sign-ins for the dashboard's login log.
 *
 * Never throws. An audit row that fails to write must not stop someone signing
 * in — the log exists to explain access, not to gate it.
 */

/**
 * Turns a User-Agent into the short summary the log column shows.
 *
 * Deliberately crude: a full UA parser is a dependency and a maintenance burden
 * for one column, and the raw string is stored alongside for the cases this
 * gets wrong.
 */
export function describeSystem(userAgent = '') {
    const ua = String(userAgent || '');
    if (!ua) return 'Unknown device';

    const os =
        /Windows NT 10/.test(ua) ? 'Win10' :
        /Windows NT 11/.test(ua) ? 'Win11' :
        /Windows/.test(ua) ? 'Windows' :
        /Android/.test(ua) ? 'Android' :
        /iPhone|iPad|iOS/.test(ua) ? 'iOS' :
        /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
        /Linux/.test(ua) ? 'Linux' : 'Unknown OS';

    // Order matters: Edge and Opera both claim Chrome, and Chrome claims Safari.
    const browser =
        /Edg\//.test(ua) ? 'Edge' :
        /OPR\/|Opera/.test(ua) ? 'Opera' :
        /Chrome\//.test(ua) ? 'Chrome' :
        /Firefox\//.test(ua) ? 'Firefox' :
        /Safari\//.test(ua) ? 'Safari' :
        /Dart|Flutter|okhttp/i.test(ua) ? 'Mobile App' : 'Unknown browser';

    const kind = /Mobile|Android|iPhone/.test(ua) ? 'Mobile' : 'Desktop';
    return `${kind} ${os} ${browser}`;
}

/**
 * The caller's address.
 *
 * Behind nginx the socket address is the proxy, so the forwarded chain is
 * preferred — its first entry is the original client.
 */
export function clientIpOf(req) {
    if (!req) return '';
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const real = String(req.headers?.['x-real-ip'] || '').trim();
    const direct = String(req.ip || req.socket?.remoteAddress || '').trim();
    return (forwarded || real || direct).replace(/^::ffff:/i, '');
}

export async function recordLogin({ userId, role, name = '', identifier = '', req = null }) {
    try {
        if (!userId || !role) return null;
        const userAgent = String(req?.headers?.['user-agent'] || '');
        return await FoodLoginAudit.create({
            userId,
            role,
            name,
            identifier,
            ipAddress: clientIpOf(req),
            userAgent,
            systemDetails: describeSystem(userAgent),
            loginAt: new Date()
        });
    } catch (err) {
        logger.error(`[login-audit] failed to record ${role} login for ${userId}: ${err?.message || err}`);
        return null;
    }
}
