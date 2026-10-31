import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const FIELD_LOG_KINDS = ['screen', 'action', 'request_failed', 'crash', 'network', 'issue'] as const;

/**
 * What happened on an inspector's phone during an inspection, recorded only for
 * users who turned it on (`users.field_log_enabled`) and expired by the
 * retention manifest.
 *
 * `id` is minted on the device, so a retried upload cannot double a row.
 * `name` is an action or screen name and `route` a path: ids only. `note` is
 * the one free-text column, typed by the inspector on an `issue` marker.
 */
export const fieldLogEvents = sqliteTable('field_log_events', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    userId:       text('user_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    occurredAt:   integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    kind:         text('kind', { enum: FIELD_LOG_KINDS }).notNull(),
    name:         text('name').notNull(),
    route:        text('route'),
    status:       integer('status'),
    note:         text('note'),
}, (t) => [
    index('idx_field_log_events_inspection').on(t.tenantId, t.inspectionId, t.occurredAt),
    index('idx_field_log_events_occurred_at').on(t.occurredAt),
]);
