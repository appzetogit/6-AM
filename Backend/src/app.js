import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoSanitize from 'mongo-sanitize';
import xssClean from 'xss-clean';
import routes from './routes/index.js';
import deployRoutes, { isDeployWebhookConfigured } from './routes/deploy.routes.js';
import shareLinksRoutes from './modules/food/public/shareLinks.routes.js';
import errorHandler from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import { responseTimeLogger } from './middleware/responseTimeLogger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { healthCheck } from './config/health.js';
import { config } from './config/env.js';

const app = express();

// Trust first proxy (essential for express-rate-limit if behind a proxy)
app.set('trust proxy', 1);

// Request ID tracing (before other middlewares so all logs can use it)
app.use(requestIdMiddleware);

// Health endpoints (no rate limit, minimal JSON, no secrets)
app.get('/health', async (_req, res) => {
    try {
        const data = await healthCheck();
        res.status(200).json(data);
    } catch (err) {
        res.status(503).json({ status: 'DOWN', error: 'Health check failed' });
    }
});
app.get('/ready', (_req, res) => {
    res.status(200).json({ status: 'ready' });
});

// Security & parsing middlewares
app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: config.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    xssFilter: true,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(cors());
app.use(morgan('dev'));
/**
 * Paths whose HMAC signature is computed over the bytes as sent.
 *
 * Re-serializing req.body is not equivalent: express.json() reorders nothing but
 * drops the original whitespace, and the sanitizers below mutate the object
 * afterwards — so a hash taken from JSON.stringify(req.body) does not match what
 * the sender signed. Keep the untouched buffer for these routes.
 */
const RAW_BODY_PATHS = ['/webhook/razorpay', '/api/deploy'];

app.use(express.json({
    verify: (req, res, buf) => {
        const url = req.originalUrl || '';
        if (RAW_BODY_PATHS.some((path) => url.includes(path))) {
            req.rawBody = buf;
        }
    }
}));
app.use(express.urlencoded({ extended: true }));

// Protect against NoSQL injection and XSS
app.use((req, _res, next) => {
    req.body = mongoSanitize(req.body);
    req.query = mongoSanitize(req.query);
    req.params = mongoSanitize(req.params);
    next();
});
app.use(xssClean());

// Global rate limiting for API routes
app.use('/api', apiRateLimiter);

// Optional: log API response time (method, path, status, duration) - no sensitive data
app.use('/api', responseTimeLogger);

// Deploy webhook — mounted only when fully configured (see deploy.routes.js).
// Kept under /api so the global rate limiter applies to it.
if (isDeployWebhookConfigured()) {
    app.use('/api/deploy', deployRoutes);
}

// API Routes
app.use('/api', routes);

// Public share-link landing pages and the Android App Links manifest.
// Mounted at the root, not under /api, because these paths are what shared links
// point at and what Android matches its intent filter against.
app.use(shareLinksRoutes);

// Dev-only: serve uploaded files when nginx is not in front (production uses nginx)
if (config.nodeEnv === 'development') {
    app.use('/uploads', express.static(path.resolve(config.uploadStorageRoot)));
}

// Error Handling
app.use(errorHandler);

export default app;
