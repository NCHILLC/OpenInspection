import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The last copy of each ISN order this app has read, as ISN's `GET /order/{id}`
 * returned it. Written by the ISN webhook receiver (`POST /webhooks/isn`), which
 * trusts the webhook only for WHICH order changed and always re-fetches the order
 * itself, so `payload` is ISN's word, never the webhook body's.
 *
 * A table of its own rather than columns on `inspections`: the public report
 * spreads the inspection row to any link holder, and an ISN order carries gate
 * and lockbox codes.
 */
export const isnOrders = sqliteTable('isn_orders', {
    id:          text('id').primaryKey(),
    tenantId:    text('tenant_id').notNull(),
    // ISN's uuid for the order (`order_id` in a webhook, `id` in GET /order).
    isnOrderId:  text('isn_order_id').notNull(),
    // The OI inspection this order became. Null until the order is applied to one.
    inspectionId: text('inspection_id'),
    payload:     text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    fetchedAt:   integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('uq_isn_orders_tenant_order').on(t.tenantId, t.isnOrderId),
]);
