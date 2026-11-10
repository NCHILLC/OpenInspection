import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import mappingRoutes from '../../../server/api/integrations-isn-mappings';
import { intakeIsnOrder } from '../../../server/services/isn/order-intake';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle } from 'drizzle-orm/d1';

const TENANT = 'mapping-tenant';
const D1 = {} as D1Database;
const CFG = { domain: 'https://isn.test', companyKey: 'co', accessKey: 'access-test', secretKey: 'secret-test' };
const KEYS = { ISN_DOMAIN: CFG.domain, ISN_COMPANY_KEY: CFG.companyKey, ISN_ACCESS_KEY: CFG.accessKey, ISN_SECRET_KEY: CFG.secretKey };
let db: BetterSQLite3Database<typeof schema>;
let order: Record<string, unknown>;
let catalogue: unknown;

function call(method: 'GET' | 'PUT', body?: unknown, role = 'owner', tenant = TENANT, typeId = 'type-home') {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => { c.set('userRole', role as never); c.set('tenantId', tenant); await next(); });
    app.onError((error, c) => error instanceof AppError ? c.json({ error: { message: error.message } }, error.status) : c.json({ success: false }, 500));
    app.route('/isn', mappingRoutes);
    return app.request(`/isn/order-types${method === 'PUT' ? `/${typeId}/template` : ''}`, {
        method, ...(method === 'PUT' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    }, { DB: D1, ...KEYS });
}
const receive = () => intakeIsnOrder(D1, TENANT, CFG, String(order.id));

beforeEach(async () => {
    const fixture = createTestDb(); db = fixture.db; await setupSchema(fixture.sqlite);
    vi.mocked(drizzle).mockReturnValue(db as never);
    for (const id of [TENANT, 'other']) await db.insert(schema.tenants).values({ id, slug: id, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    for (const [id, tenantId, retiredAt] of [['mapped', TENANT, null], ['service-default', TENANT, null], ['retired', TENANT, new Date()], ['foreign', 'other', null]] as const) {
        await db.insert(schema.templates).values({ id, tenantId, name: id, slug: id, version: 3, schema: { schemaVersion: 2, sections: [] }, createdAt: new Date(), retiredAt } as never);
    }
    await db.insert(schema.services).values({ id: 'svc', tenantId: TENANT, name: 'Home inspection', price: 0, templateId: 'service-default', active: true, sortOrder: 0, createdAt: new Date() } as never);
    order = { id: 'order-1', oid: 1, ordertype: 'type-home', address1: '1 Main St', services: [{ name: 'Home inspection' }] };
    // Minimal controlled catalogue/order bodies for application tests. Vendor
    // endpoint and ordertype identity are documented in the ISN scheduling guide.
    catalogue = { status: 'ok', ordertypes: [{ id: 'type-home', name: 'Home &amp; condo' }] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(new URL(url).pathname.endsWith('/ordertypes') ? catalogue : { status: 'ok', order }))));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ISN primary template mappings', () => {
    it('lists the ISN catalogue and persists a template used for new imports without changing service selection', async () => {
        expect((await call('PUT', { templateId: 'mapped' })).status).toBe(200);
        const list = await (await call('GET')).json() as { data: { orderTypes: unknown[] } };
        expect(list.data.orderTypes).toEqual([{ id: 'type-home', name: 'Home & condo', templateId: 'mapped', unavailable: false }]);
        const imported = await receive();
        expect(db.select().from(schema.inspections).get()).toMatchObject({ id: imported.inspectionId, templateId: 'mapped', templateSnapshotVersion: 3 });
        expect(db.select().from(schema.reports).get()).toMatchObject({ inspectionId: imported.inspectionId, templateId: 'mapped', kind: 'primary' });
        expect(db.select().from(schema.inspectionServices).get()?.serviceId).toBe('svc');
    });

    it('saving a mapping and ordinary refresh leave an existing inspection’s template alone', async () => {
        await receive();
        expect((await call('PUT', { templateId: 'mapped' })).status).toBe(200);
        await receive();
        expect(db.select().from(schema.inspections).get()?.templateId).toBe('service-default');
        expect(db.select().from(schema.reports).get()?.templateId).toBe('service-default');
    });

    it('clearing a mapping restores service defaults for future imports', async () => {
        await call('PUT', { templateId: 'mapped' }); await call('PUT', { templateId: null }); await receive();
        expect(db.select().from(schema.inspections).get()?.templateId).toBe('service-default');
        expect(db.select().from(schema.isnOrderTypeTemplates).all()).toHaveLength(0);
    });

    it.each(['inspector', 'agent', 'client'])('refuses %s from reading or writing mappings', async (role) => {
        expect((await call('GET', undefined, role)).status).toBe(403);
        expect((await call('PUT', { templateId: 'mapped' }, role)).status).toBe(403);
    });

    it('validates template ownership, retirement, order type and request shape', async () => {
        expect((await call('PUT', { templateId: 'foreign' })).status).toBe(409);
        expect((await call('PUT', { templateId: 'retired' })).status).toBe(409);
        expect((await call('PUT', { templateId: 'missing' })).status).toBe(409);
        expect((await call('PUT', { templateId: 'mapped' }, 'owner', TENANT, 'unknown')).status).toBe(400);
        expect((await call('PUT', { templateId: 42 })).status).toBe(400);
    });

    it('reports an unavailable configured mapping and refuses new imports without substituting a service default', async () => {
        await call('PUT', { templateId: 'mapped' });
        await db.update(schema.templates).set({ retiredAt: new Date() }).where(eq(schema.templates.id, 'mapped'));
        const list = await (await call('GET')).json() as { data: { orderTypes: Array<{ unavailable: boolean }> } };
        expect(list.data.orderTypes[0]?.unavailable).toBe(true);
        await expect(receive()).rejects.toThrow('mapped report template is unavailable');
        expect(db.select().from(schema.inspections).all()).toHaveLength(0);
        expect(db.select().from(schema.isnOrders).get()?.inspectionId).toBeNull();
    });

    it('keeps mappings tenant-scoped and refuses a malformed catalogue instead of showing an empty list', async () => {
        await call('PUT', { templateId: 'mapped' });
        const other = await (await call('GET', undefined, 'owner', 'other')).json() as { data: { orderTypes: Array<{ templateId: string | null }> } };
        expect(other.data.orderTypes[0]?.templateId).toBeNull();
        catalogue = { status: 'ok' };
        expect((await call('GET')).status).toBe(503);
    });
});
