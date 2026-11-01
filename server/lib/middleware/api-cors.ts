import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import { CSP_REPORT_PATH } from '../page-security-headers';

// CORS — allows React Router v7 frontend (separate origin in dev) to call API endpoints.
// In production both share the same origin; this is primarily for local dev
// where Vite runs on :5173 and the API Worker runs on :8787.
const reflectOriginCors = cors({
    origin: (origin) => origin,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Token-Relay'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Set-Cookie'],
});

/** CORS for /api/*. The CSP report receiver is posted to by the browser itself, same origin, and
 * answers with no CORS headers at all: reflecting an origin back would only invite cross-site callers. */
export const apiCors: MiddlewareHandler = (c, next) =>
    c.req.path === CSP_REPORT_PATH ? next() : reflectOriginCors(c, next);
