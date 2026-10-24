/**
 * Re-reads one ISN order and keeps the copy in `isn_orders`. Idempotent: the
 * same order fetched twice leaves one row holding ISN's current state, so a
 * duplicate or out-of-order webhook delivery costs one extra GET and nothing else.
 */
import { drizzle } from 'drizzle-orm/d1';
import { isnOrders } from '../../lib/db/schema';
import { isnCall, type IsnConfig } from './api-base';

export async function pullIsnOrder(db: D1Database, tenantId: string, cfg: IsnConfig, orderRef: string, now = new Date()): Promise<string> {
    const order = (await isnCall(cfg, 'GET', `/order/${encodeURIComponent(orderRef)}`)).order as Record<string, unknown> | undefined;
    if (typeof order?.id !== 'string') throw new Error(`ISN returned no order for "${orderRef}"`);
    await drizzle(db).insert(isnOrders)
        .values({ id: crypto.randomUUID(), tenantId, isnOrderId: order.id, payload: order, fetchedAt: now })
        .onConflictDoUpdate({ target: [isnOrders.tenantId, isnOrders.isnOrderId], set: { payload: order, fetchedAt: now } })
        .run();
    return order.id;
}
