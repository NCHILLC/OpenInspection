/** Intake behavior against migrated SQLite, with ISN order responses controlled at fetch. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle } from 'drizzle-orm/d1';
import { intakeIsnOrder, STALE_CLAIM_MS } from '../../../server/services/isn/order-intake';
import { InspectionCoreService } from '../../../server/services/inspection/inspection-core.service';

const CFG = { domain: 'https://isn.test', companyKey: 'co', accessKey: 'access-test', secretKey: 'secret-test' };
const TENANT = 'intake-tenant';
const NOW = new Date('2026-11-05T12:00:00Z');
const D1 = {} as D1Database;
let db: BetterSQLite3Database<typeof schema>;
let order: Record<string, unknown>;
const receive = () => intakeIsnOrder(D1, TENANT, CFG, 'order-1', NOW);
const stored = () => db.select().from(schema.isnOrders).where(eq(schema.isnOrders.tenantId, TENANT)).get();

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    vi.mocked(drizzle).mockReturnValue(db as never);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'intake', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: NOW });
    order = { id: 'order-1', oid: 9, address1: '1 Main St', datetime: '2026-11-06 10:00:00', canceled: 'no' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', order }))));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ISN intake', () => {
    it('repeated and competing deliveries create one inspection and keep a single order link', async () => {
        await Promise.all([receive(), receive(), receive()]);
        const first = stored()!;
        expect(first.inspectionId).toBeTruthy();
        expect(first.inspectionId).not.toMatch(/^pending:/);
        order = { ...order, datetime: '2026-11-07 11:00:00' };
        expect((await receive()).inspectionId).toBe(first.inspectionId);
        expect(db.select().from(schema.inspections).all()).toHaveLength(1);
        expect(db.select().from(schema.inspections).get()?.date).toBe('2026-11-07T11:00:00');
        expect(stored()?.claimStartedAt).toBeNull();
    });

    it('a creation failure releases its claim and a retry completes the stored order', async () => {
        const create = vi.spyOn(InspectionCoreService.prototype, 'createInspection');
        create.mockRejectedValueOnce(new Error('creation unavailable'));
        await expect(receive()).rejects.toThrow('creation unavailable');
        expect(stored()).toMatchObject({ inspectionId: null, claimStartedAt: null });
        await receive();
        expect(db.select().from(schema.inspections).all()).toHaveLength(1);
        expect(stored()?.inspectionId).toBe(db.select().from(schema.inspections).get()?.id);
    });

    it('recovers an expired claim despite a recent order fetch, without touching another tenant', async () => {
        await db.insert(schema.isnOrders).values([
            { id: 'stale', tenantId: TENANT, isnOrderId: 'order-1', payload: order, fetchedAt: NOW,
                inspectionId: 'pending:dead', claimStartedAt: new Date(NOW.getTime() - STALE_CLAIM_MS - 1) },
            { id: 'foreign', tenantId: 'other', isnOrderId: 'order-1', payload: order, fetchedAt: new Date(0),
                inspectionId: 'pending:foreign', claimStartedAt: new Date(0) },
        ]);
        await receive();
        expect(stored()?.inspectionId).not.toBe('pending:dead');
        expect(db.select().from(schema.inspections).all()).toHaveLength(1);
        expect(db.select().from(schema.isnOrders).where(eq(schema.isnOrders.id, 'foreign')).get()?.inspectionId).toBe('pending:foreign');
    });

    it('a duplicate updates the payload without extending a live creation lease', async () => {
        const claimedAt = new Date(NOW.getTime() - 60_000);
        await db.insert(schema.isnOrders).values({ id: 'fresh', tenantId: TENANT, isnOrderId: 'order-1', payload: {},
            fetchedAt: new Date(0), inspectionId: 'pending:live', claimStartedAt: claimedAt });
        expect((await receive()).inspectionId).toBeNull();
        expect(stored()).toMatchObject({ inspectionId: 'pending:live', claimStartedAt: claimedAt, payload: order });
        expect(db.select().from(schema.inspections).all()).toHaveLength(0);
    });

    it('an ISN failure preserves an existing link and inspection', async () => {
        const first = await receive();
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'error', message: 'ISN unavailable' }))));
        await expect(receive()).rejects.toThrow('ISN unavailable');
        expect(stored()?.inspectionId).toBe(first.inspectionId);
        expect(db.select().from(schema.inspections).all()).toHaveLength(1);
    });
});
