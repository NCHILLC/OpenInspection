/** One boundary for ISN order storage, creation leases, linking and recovery. */
import { and, eq, isNull, like, lt, or } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { isnOrders } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { isnCall, type IsnConfig } from './api-base';
import { createInspectionFromIsn, updateInspectionFromIsn } from './order-apply';

export const STALE_CLAIM_MS = 15 * 60 * 1000;
type StoredOrder = { id: string; inspectionId: string | null; payload: Record<string, unknown> };

/**
 * A crash AFTER createInspection but BEFORE linking can still leave an orphan
 * inspection; recovering that lease may create a second inspection. This is
 * competing-delivery protection, not exactly-once creation.
 */
export async function releaseStaleIsnClaims(db: DrizzleD1Database, tenantId: string, now = new Date()) {
    const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
    await db.update(isnOrders).set({ inspectionId: null, claimStartedAt: null })
        .where(and(eq(isnOrders.tenantId, tenantId), like(isnOrders.inspectionId, 'pending:%'),
            or(lt(isnOrders.claimStartedAt, cutoff), and(isNull(isnOrders.claimStartedAt), lt(isnOrders.fetchedAt, cutoff)))));
}

/** Internal application seam; callers fetching orders use intakeIsnOrder. */
export async function applyStoredIsnOrder(d1: D1Database, tenantId: string, cfg: IsnConfig, row: StoredOrder, now = new Date()): Promise<string | null> {
    const db = drizzle(d1);
    if (row.inspectionId?.startsWith('pending:')) return null;
    if (row.inspectionId) return updateInspectionFromIsn(d1, db, cfg, tenantId, row.id, row.inspectionId, row.payload);

    const claim = `pending:${crypto.randomUUID()}`;
    const claimed = await db.update(isnOrders).set({ inspectionId: claim, claimStartedAt: now })
        .where(and(eq(isnOrders.id, row.id), eq(isnOrders.tenantId, tenantId), isNull(isnOrders.inspectionId)))
        .returning({ id: isnOrders.id });
    if (claimed.length === 0) return null;
    const ownsClaim = and(eq(isnOrders.id, row.id), eq(isnOrders.tenantId, tenantId), eq(isnOrders.inspectionId, claim));
    let created: string | null;
    try {
        created = await createInspectionFromIsn(d1, db, cfg, tenantId, row);
    } catch (error) {
        await db.update(isnOrders).set({ inspectionId: null, claimStartedAt: null }).where(ownsClaim);
        throw error;
    }
    const linked = await db.update(isnOrders).set({ inspectionId: created, claimStartedAt: null })
        .where(ownsClaim).returning({ payload: isnOrders.payload });
    if (!created || linked.length === 0) return null;
    return updateInspectionFromIsn(d1, db, cfg, tenantId, row.id, created, linked[0]!.payload);
}

export async function intakeIsnOrder(d1: D1Database, tenantId: string, cfg: IsnConfig, orderRef: string, now = new Date(), expectedInspectionId?: string) {
    const order = (await isnCall(cfg, 'GET', `/order/${encodeURIComponent(orderRef)}`)).order as Record<string, unknown> | undefined;
    if (typeof order?.id !== 'string' || !order.id.trim()) throw new Error('ISN returned no order for the requested reference');
    const db = drizzle(d1);
    if (expectedInspectionId) {
        if (order.id !== orderRef) throw Errors.Conflict('ISN returned a different order; the inspection link was kept');
        const rows = await db.update(isnOrders).set({ payload: order, fetchedAt: now })
            .where(and(eq(isnOrders.tenantId, tenantId), eq(isnOrders.isnOrderId, orderRef), eq(isnOrders.inspectionId, expectedInspectionId)))
            .returning();
        if (!rows[0]) throw Errors.NotFound('This inspection is no longer linked to that ISN order');
        return { isnOrderId: order.id, inspectionId: await applyStoredIsnOrder(d1, tenantId, cfg, rows[0], now) };
    }
    // Recover BEFORE updating fetchedAt, including claims created before claimStartedAt existed.
    await releaseStaleIsnClaims(db, tenantId, now);
    await db.insert(isnOrders)
        .values({ id: crypto.randomUUID(), tenantId, isnOrderId: order.id, payload: order, fetchedAt: now })
        .onConflictDoUpdate({ target: [isnOrders.tenantId, isnOrders.isnOrderId], set: { payload: order, fetchedAt: now } }).run();
    const row = await db.select().from(isnOrders)
        .where(and(eq(isnOrders.tenantId, tenantId), eq(isnOrders.isnOrderId, order.id))).get();
    const inspectionId = row ? await applyStoredIsnOrder(d1, tenantId, cfg, row, now) : null;
    return { isnOrderId: order.id, inspectionId };
}
