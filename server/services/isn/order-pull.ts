/**
 * Re-reads one ISN order, keeps the copy in `isn_orders`, then applies it to
 * the OI inspection (`order-apply.ts`). Idempotent: the same order fetched twice
 * leaves one row holding ISN's current state and one inspection matching it, so
 * a duplicate or out-of-order webhook delivery costs a few extra GETs and nothing else.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { isnOrders } from '../../lib/db/schema';
import { isnCall, type IsnConfig } from './api-base';
import { applyIsnOrder } from './order-apply';

export async function pullIsnOrder(db: D1Database, tenantId: string, cfg: IsnConfig, orderRef: string, now = new Date()): Promise<string> {
    const order = (await isnCall(cfg, 'GET', `/order/${encodeURIComponent(orderRef)}`)).order as Record<string, unknown> | undefined;
    if (typeof order?.id !== 'string') throw new Error(`ISN returned no order for "${orderRef}"`);
    const orm = drizzle(db);
    await orm.insert(isnOrders)
        .values({ id: crypto.randomUUID(), tenantId, isnOrderId: order.id, payload: order, fetchedAt: now })
        .onConflictDoUpdate({ target: [isnOrders.tenantId, isnOrders.isnOrderId], set: { payload: order, fetchedAt: now } })
        .run();
    const row = await orm.select({ id: isnOrders.id, inspectionId: isnOrders.inspectionId }).from(isnOrders)
        .where(and(eq(isnOrders.tenantId, tenantId), eq(isnOrders.isnOrderId, order.id))).get();
    if (row) await applyIsnOrder(db, tenantId, cfg, { ...row, payload: order });
    return order.id;
}
