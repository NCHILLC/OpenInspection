import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { inspections, isnOrders } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import type { IsnConfig } from './api-base';
import { intakeIsnOrder } from './order-intake';

export async function refreshIsnInspection(d1: D1Database, tenantId: string, cfg: IsnConfig, inspectionId: string) {
    const row = await drizzle(d1).select({ isnOrderId: isnOrders.isnOrderId }).from(isnOrders)
        .innerJoin(inspections, and(eq(inspections.id, isnOrders.inspectionId), eq(inspections.tenantId, tenantId)))
        .where(and(eq(isnOrders.tenantId, tenantId), eq(isnOrders.inspectionId, inspectionId))).get();
    if (!row) throw Errors.NotFound('This inspection has no linked ISN order');
    return intakeIsnOrder(d1, tenantId, cfg, row.isnOrderId, new Date(), inspectionId);
}
