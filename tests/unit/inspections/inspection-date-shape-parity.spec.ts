/**
 * `inspections.date` holds TWO shapes and the dashboard must not care which.
 *
 * The column is the tenant's civil day. The booking path writes it with the
 * appointment's wall-clock time attached — `2026-09-23T13:00:00Z` — where that
 * `Z` is naive: the true instant is computed separately into
 * `scheduledStartMs`. Manual and legacy rows carry a bare `2026-09-23`. Both
 * are live in production today; a real database holds both side by side.
 *
 * Nothing pinned that. The comments claimed the column was bare-day-only, the
 * fixtures seeded whichever shape their author had in mind, and the bucket
 * logic happened to work on both because a naive `Z` keeps the calendar day
 * the string already names. "Happened to work" is the part worth a test: the
 * moment one write path is normalized without the other, or a reader starts
 * treating the value as a real instant, these buckets diverge for half the
 * rows and nothing else in the suite would notice.
 *
 * Both rows are read from ONE `getDashboardBuckets` call on purpose, so the
 * comparison cannot straddle a UTC midnight and fail for a reason that has
 * nothing to do with shape.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionAnalyticsService } from '../../../server/services/inspection/inspection-analytics.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000000f3';
const facadeStub = {} as unknown as import('../../../server/services/inspection.service').InspectionService;

const DAY = 86_400_000;
/** The civil day `n` days from now, as the product writes it. */
const civilDay = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

describe('dashboard buckets — the two shapes of inspections.date agree', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionAnalyticsService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new InspectionAnalyticsService({} as D1Database, undefined, undefined, undefined, undefined, facadeStub);

        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'shapeco',
            status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    /** `createdAt` is recent so the agreement-staleness clause in needsAttention
     *  cannot mask the bucket under test — the same trap the overdue spec names. */
    async function seed(id: string, dateValue: string) {
        await testDb.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: id,
            date: dateValue, status: 'scheduled', paymentStatus: 'unpaid',
            price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
    }

    const bucketsOf = (r: Awaited<ReturnType<InspectionAnalyticsService['getDashboardBuckets']>>, id: string) =>
        (['needsAttention', 'today', 'thisWeek', 'later', 'recentReports', 'cancelled'] as const)
            .filter(k => r[k].some(x => x.id === id));

    for (const [label, offset] of [['two days past', -2], ['today', 0], ['three days ahead', 3]] as const) {
        it(`buckets a bare day and a wall-clock day identically — ${label}`, async () => {
            const day = civilDay(offset);
            await seed('i-bare', day);
            // The naive `Z` the booking path writes. 09:00 keeps it clear of both
            // midnights, so the row cannot drift into a neighbouring civil day.
            await seed('i-clock', `${day}T09:00:00Z`);

            const res = await svc.getDashboardBuckets(TENANT);
            const bare = bucketsOf(res, 'i-bare');

            expect(bare.length, 'the bare-day row must land somewhere to compare against').toBeGreaterThan(0);
            expect(bucketsOf(res, 'i-clock')).toEqual(bare);
        });
    }

    it('puts a past day in needsAttention whichever shape it wears', async () => {
        // The shape parity above would also hold if BOTH shapes fell through
        // every bucket, so one absolute assertion anchors it to real behaviour.
        const day = civilDay(-2);
        await seed('i-bare', day);
        await seed('i-clock', `${day}T09:00:00Z`);

        const res = await svc.getDashboardBuckets(TENANT);
        expect(bucketsOf(res, 'i-bare')).toContain('needsAttention');
        expect(bucketsOf(res, 'i-clock')).toContain('needsAttention');
    });
});
