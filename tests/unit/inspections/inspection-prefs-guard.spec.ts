import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import inspectionPrefsRoutes from '../../../server/api/inspection-prefs';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { Role } from '../../../server/lib/auth/roles';

function call(role: Role, method: string, path: string, body: unknown) {
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => err instanceof AppError ? c.json({ error: err.message }, err.status) : c.json({ error: String(err) }, 500));
    app.use('*', async (c, next) => { c.set('userRole', role); c.set('tenantId', 't1'); await next(); });
    app.route('/', inspectionPrefsRoutes as never);
    return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { DB: {} });
}

describe('inspection prefs write guards', () => {
    it('an inspector cannot patch company policy fields', async () => {
        for (const patch of [{ requireDefectFields: 'both' }, { agentRepairAccess: 'off' }, { reportLinkTtl: 'never' }]) {
            expect((await call('inspector', 'PATCH', '/', patch)).status).toBe(403);
        }
    });
    it('an inspector cannot bulk-expire report links', async () => {
        expect((await call('inspector', 'POST', '/report-link-expiry', { ttl: 'never' })).status).toBe(403);
    });
    it('CONTROL - an inspector can patch editor ergonomics; a manager passes the policy check', async () => {
        expect((await call('inspector', 'PATCH', '/', { autoAdvance: 'off' })).status).not.toBe(403);
        expect((await call('manager', 'PATCH', '/', { requireDefectFields: 'both' })).status).not.toBe(403);
        expect((await call('manager', 'POST', '/report-link-expiry', { ttl: 'never' })).status).not.toBe(403);
    });
});
