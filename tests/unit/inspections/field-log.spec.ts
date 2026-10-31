import { describe, expect, it } from 'vitest';
import { issuesWithContext } from '../../../server/api/field-log';
import { FieldLogEventSchema } from '../../../server/lib/validations/field-log.schema';
import { RETENTION_MANIFEST } from '../../../server/lib/compliance/retention-manifest';

const event = {
    id: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
    inspectionId: 'insp-1',
    occurredAt: 1,
    kind: 'action' as const,
    name: 'rating',
};

describe('field log event schema', () => {
    it('accepts ids and action names', () => {
        expect(FieldLogEventSchema.safeParse(event).success).toBe(true);
    });

    it('accepts a note on an issue marker only', () => {
        expect(FieldLogEventSchema.safeParse({ ...event, kind: 'issue', note: 'stuck' }).success).toBe(true);
        expect(FieldLogEventSchema.safeParse({ ...event, note: 'Jane Doe, 12 Oak St' }).success).toBe(false);
    });

    it('refuses prose in the name and a query string in the route', () => {
        expect(FieldLogEventSchema.safeParse({ ...event, name: 'Jane Doe called' }).success).toBe(false);
        expect(FieldLogEventSchema.safeParse({ ...event, route: '/x?email=a@b.c' }).success).toBe(false);
    });
});

describe('issuesWithContext', () => {
    it('attaches the five minutes before a marker, nothing older or later', () => {
        const at = 10 * 60_000;
        const rows = [
            { id: 'old', occurredAt: at - 6 * 60_000, kind: 'action' },
            { id: 'near', occurredAt: at - 60_000, kind: 'request_failed' },
            { id: 'mark', occurredAt: at, kind: 'issue' },
            { id: 'after', occurredAt: at + 1, kind: 'action' },
        ];
        expect(issuesWithContext(rows)).toEqual([{ ...rows[2], precedingEventIds: ['near'] }]);
    });
});

describe('field log retention', () => {
    it('expires events after 30 days', () => {
        expect(RETENTION_MANIFEST.find((r) => r.table === 'field_log_events')?.window).toEqual({ unit: 'days', value: 30 });
    });
});
