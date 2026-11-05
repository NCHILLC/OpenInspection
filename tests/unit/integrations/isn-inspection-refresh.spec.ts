import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import isnRoutes from '../../../server/api/inspections/isn-card';
import { intakeIsnOrder } from '../../../server/services/isn/order-intake';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle } from 'drizzle-orm/d1';

const CFG = { domain: 'https://isn.test', companyKey: 'co', accessKey: 'access-test', secretKey: 'secret-test' };
const KEYS = { ISN_DOMAIN: CFG.domain, ISN_COMPANY_KEY: CFG.companyKey, ISN_ACCESS_KEY: CFG.accessKey, ISN_SECRET_KEY: CFG.secretKey, ISN_WEBHOOK_SECRET: 'webhook-test' };
const TENANT = 'refresh-tenant';
const D1 = {} as D1Database;
let db: BetterSQLite3Database<typeof schema>;
let inspectionId: string;
let order: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

function call(role: string | null = 'inspector', tenant = TENANT, id = inspectionId, keys: Record<string, string> = KEYS, action = 'refresh', namespace?: unknown) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        if (role) c.set('userRole', role as never);
        c.set('tenantId', tenant);
        await next();
    });
    app.onError((error, c) => error instanceof AppError
        ? c.json({ success: false, error: { message: error.message } }, error.status)
        : c.json({ success: false }, 500));
    app.route('/api/inspections', isnRoutes);
    return app.request(`/api/inspections/${id}/isn/${action}`, { method: 'POST' }, { DB: D1, ...keys, ...(namespace ? { INSPECTION_DOC: namespace } : {}) });
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    vi.mocked(drizzle).mockReturnValue(db as never);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'refresh', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    order = { id: 'isn-1', oid: 10, address1: '1 Main St', datetime: '2026-11-06 10:00:00', canceled: 'no' };
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok', order })));
    vi.stubGlobal('fetch', fetchMock);
    inspectionId = (await intakeIsnOrder(D1, TENANT, CFG, 'isn-1')).inspectionId!;
    fetchMock.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('refresh a linked inspection', () => {
    it.each(['owner', 'manager', 'inspector'])('allows %s without a scheduling override and repeated refresh does not create another inspection', async (role) => {
        order = { ...order, address1: '2 Main St', datetime: '2026-11-07 14:00:00' };
        expect((await call(role)).status).toBe(200);
        expect((await call(role)).status).toBe(200);
        expect(db.select().from(schema.inspections).all()).toHaveLength(1);
        expect(db.select().from(schema.inspections).get()).toMatchObject({ id: inspectionId, propertyAddress: '2 Main St', date: '2026-11-07T14:00:00' });
    });

    it.each(['agent', 'client', null])('refuses %s before contacting ISN', async (role) => {
        expect((await call(role)).status).toBe(role ? 403 : 401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not expose or refresh another tenant’s link or an unlinked inspection', async () => {
        expect((await call('owner', 'other')).status).toBe(404);
        expect((await call('owner', TENANT, 'missing')).status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requires the existing intake configuration', async () => {
        expect((await call('owner', TENANT, inspectionId, { ...KEYS, ISN_WEBHOOK_SECRET: '' })).status).toBe(503);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns a redacted ISN failure and preserves the link for retry', async () => {
        fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ status: 'error', message: `Invalid ${CFG.secretKey} ${KEYS.ISN_WEBHOOK_SECRET}` })));
        const res = await call();
        expect(res.status).toBe(502);
        const text = await res.text();
        expect(text).toContain('[redacted]');
        expect(text).not.toContain(CFG.secretKey);
        expect(text).not.toContain(KEYS.ISN_WEBHOOK_SECRET);
        expect(db.select().from(schema.isnOrders).get()?.inspectionId).toBe(inspectionId);
        expect((await call()).status).toBe(200);
    });

    it('refuses an unexpected order identity and preserves the original order and link', async () => {
        order = { ...order, id: 'different-order' };
        expect((await call()).status).toBe(409);
        expect(db.select().from(schema.isnOrders).all()).toHaveLength(1);
        expect(db.select().from(schema.isnOrders).where(eq(schema.isnOrders.tenantId, TENANT)).get()?.isnOrderId).toBe('isn-1');
        expect(db.select().from(schema.inspections).all()).toHaveLength(1);
    });
    it.each(['owner', 'manager', 'inspector'])('allows %s to apply through the tenant-scoped primary document', async (role) => {
        const forwarded = vi.fn(async () => Response.json({ success: true, changed: true }));
        const namespace = { idFromName: vi.fn((name: string) => name), get: () => ({ fetch: forwarded }) };
        expect((await call(role, TENANT, inspectionId, KEYS, 'apply-template', namespace)).status).toBe(200);
        const primary = db.select().from(schema.reports).get()!;
        expect(namespace.idFromName).toHaveBeenCalledWith(`${TENANT}:${primary.id}`);
        expect(forwarded).toHaveBeenCalledWith('https://do/isn-template', { method: 'POST', headers: {
            'x-tenant-id': TENANT, 'x-inspection-id': inspectionId, 'x-report-id': primary.id,
        } });
    });
    it.each(['agent', 'client'])('refuses %s from applying a template', async (role) => {
        expect((await call(role, TENANT, inspectionId, KEYS, 'apply-template')).status).toBe(403);
    });
});
