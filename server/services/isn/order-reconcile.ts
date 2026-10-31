/**
 * The safety net under the ISN webhook: re-reads ISN's today-forward orders and
 * pulls every one OI is missing or holds an older copy of. The same pass is the
 * first-run backfill (decision D1, 2026-10-20): on an empty `isn_orders` every
 * listed order is missing.
 *
 * ISN's `GET /orders` has no paging (the spec: "the full collection is
 * returned"), so one list call per batch, then at most `limit` order pulls,
 * resumed after the last ISN order id pulled.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, like, lt } from 'drizzle-orm';
import { isnOrders } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { isnCall, type IsnConfig } from './api-base';
import { orderFacts } from './order-payload';
import { pullIsnOrder } from './order-pull';

/** A `pending:` claim older than this was left by a Worker that died mid-create. */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

type Rec = Record<string, unknown>;

export async function reconcileIsnOrders(
    d1: D1Database, tenantId: string, cfg: IsnConfig, cursor: string | null, limit: number, now = new Date(),
): Promise<{ processed: number; failed: number; nextCursor: string | null }> {
    const db = drizzle(d1);
    // Free the claim so the pull below (or the next webhook) can create the inspection.
    // ponytail: a Worker killed AFTER createInspection but before linking leaves an
    // inspection this cannot see, and the retry makes a second one; rare, fix by hand.
    await db.update(isnOrders).set({ inspectionId: null })
        .where(and(eq(isnOrders.tenantId, tenantId), like(isnOrders.inspectionId, 'pending:%'),
            lt(isnOrders.fetchedAt, new Date(now.getTime() - STALE_CLAIM_MS))));

    // From yesterday (UTC), so an evening order in a US timezone is not cut off.
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const listed = ((await isnCall(cfg, 'GET', '/orders', { datetimeafter: since })).orders ?? []) as Rec[];
    const orders = listed.filter((o) => typeof o.id === 'string' && (!cursor || (o.id as string) > cursor))
        .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));

    const stored = new Map<string, { inspectionId: string | null; modified: unknown }>();
    for (let i = 0; i < orders.length; i += 50) {
        const ids = orders.slice(i, i + 50).map((o) => o.id as string);
        const rows = await db.select({ isnOrderId: isnOrders.isnOrderId, inspectionId: isnOrders.inspectionId, payload: isnOrders.payload })
            .from(isnOrders).where(and(eq(isnOrders.tenantId, tenantId), inArray(isnOrders.isnOrderId, ids))).limit(50).all();
        for (const r of rows) stored.set(r.isnOrderId, { inspectionId: r.inspectionId, modified: r.payload.modified });
    }
    const due = orders.filter((o) => {
        const s = stored.get(o.id as string);
        // Changed in ISN, or never became an inspection (a failed create) and still could.
        return !s || s.modified !== o.modified || (s.inspectionId === null && !orderFacts(o).canceled);
    });

    let processed = 0;
    let failed = 0;
    for (const o of due.slice(0, limit)) {
        try {
            await pullIsnOrder(d1, tenantId, cfg, o.id as string, now);
            processed++;
        } catch (e) {
            // One bad order must not stall the rest; the next pass tries it again.
            failed++;
            logger.error('ISN reconcile: order pull failed', { isnOrderId: o.id }, e instanceof Error ? e : undefined);
        }
    }
    const nextCursor = due.length > limit ? (due[limit - 1]!.id as string) : null;
    if (due.length > 0) logger.info('ISN reconcile', { listed: listed.length, due: due.length, processed, failed, more: nextCursor !== null });
    return { processed, failed, nextCursor };
}
