/**
 * Inspections that came from ISN, each with its ready check (`isnReadyCheck`):
 * the inspections list's "From ISN" filter and warning. One read of the
 * tenant's linked orders and one of their service lines; a `pending:` claim
 * matches no inspection and is skipped.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionServices, isnOrders } from '../../lib/db/schema';
import { isnReadyCheck } from './order-payload';

export type IsnReadyCheck = ReturnType<typeof isnReadyCheck>;

export async function isnReadyChecks(db: DrizzleD1Database, tenantId: string): Promise<Map<string, IsnReadyCheck>> {
    const linked = and(eq(isnOrders.tenantId, tenantId), isNotNull(isnOrders.inspectionId));
    const rows = await db.select({ inspectionId: isnOrders.inspectionId, payload: isnOrders.payload, unmatchedInspectors: isnOrders.unmatchedInspectors })
        .from(isnOrders).where(linked);
    const out = new Map<string, IsnReadyCheck>();
    if (rows.length === 0) return out;
    const lines = await db.select({ inspectionId: inspectionServices.inspectionId, name: inspectionServices.nameSnapshot })
        .from(inspectionServices)
        .where(and(eq(inspectionServices.tenantId, tenantId), eq(inspectionServices.active, true),
            inArray(inspectionServices.inspectionId, db.select({ id: isnOrders.inspectionId }).from(isnOrders).where(linked))))
        .all();
    for (const r of rows) {
        const id = r.inspectionId as string;
        out.set(id, isnReadyCheck(r.payload, lines.filter((l) => l.inspectionId === id).map((l) => l.name), r.unmatchedInspectors));
    }
    return out;
}
