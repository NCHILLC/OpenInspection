/**
 * Every metrics aggregate filters tenantId + date window only, so a cancelled
 * inspection with a price counted as volume and revenue. `inWindow` (and its
 * counterpart in services/metrics/inspector-metrics.ts) must also exclude
 * INSPECTION_STATUS.CANCELLED, in one place each, not per query.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import metricsRoutes from '../../../server/api/metrics';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT = '00000000-0000-0000-0000-000000000009';
const U1 = 'user-inspector-cancelled-1';
const SVC = 'svc-cancelled-home';

let db: BetterSQLite3Database<typeof schema>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'owner-1', role: 'owner', tenantId: TENANT });
        c.set('sdb', { getById: async () => ({ permissionOverrides: null }) } as unknown as HonoConfig['Variables']['sdb']);
        await next();
    });
    app.route('/api/metrics', metricsRoutes);
    return app;
}

const ENV = { DB: {} } as never;
const CTX = makeExecutionContext().ctx;

interface ByInspectorRow {
    inspectorId: string;
    attributedRevenueCents: number | null;
    ledCount: number;
}
interface Payload {
    totalRevenue: number | null;
    totalInspections: number;
    byInspector: ByInspectorRow[];
}

const fetchMetrics = async () => {
    const res = await buildApp().request('/api/metrics?from=2026-01-01&to=2026-12-31', {}, ENV, CTX);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: Payload }).data;
};

async function seedInspection(id: string, priceCents: number, status: string) {
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: `${id} Main St`, date: '2026-07-01',
        status, paymentStatus: 'paid', price: priceCents, createdAt: new Date(),
    } as never);
    await db.insert(schema.inspectionServices).values({
        id: `line-${id}`, tenantId: TENANT, inspectionId: id, serviceId: SVC,
        nameSnapshot: 'Home Inspection', priceSnapshot: priceCents,
    } as never);
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'cancelledco', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.users).values({
        id: U1, tenantId: TENANT, email: 'ins1@cancelledco.test', passwordHash: 'x', name: 'Cancelled Test', createdAt: new Date(),
    } as never);
    await db.insert(schema.services).values({
        id: SVC, tenantId: TENANT, name: 'Home Inspection', price: 50000, createdAt: new Date(),
    } as never);
});

describe('metrics — cancelled inspections excluded', () => {
    it('excludes a cancelled inspection with a price from totalRevenue and the inspection count', async () => {
        await seedInspection('i-completed', 50000, 'completed');
        await seedInspection('i-cancelled', 90000, 'cancelled');

        const data = await fetchMetrics();
        expect(data.totalRevenue).toBe(50000);
        expect(data.totalInspections).toBe(1);
    });

    it('excludes a cancelled inspection from per-inspector attributed revenue and led count', async () => {
        await seedInspection('i-completed', 50000, 'completed');
        await db.insert(schema.inspectionInspectors).values({
            inspectionId: 'i-completed', userId: U1, tenantId: TENANT, role: 'lead', createdAt: new Date(),
        } as never);

        await seedInspection('i-cancelled', 90000, 'cancelled');
        await db.insert(schema.inspectionInspectors).values({
            inspectionId: 'i-cancelled', userId: U1, tenantId: TENANT, role: 'lead', createdAt: new Date(),
        } as never);

        const row = (await fetchMetrics()).byInspector.find(r => r.inspectorId === U1)!;
        expect(row.ledCount).toBe(1);
        expect(row.attributedRevenueCents).toBe(50000);
    });
});
