/**
 * An open inspection whose date has passed must still appear somewhere.
 *
 * The bug: every date bucket `getDashboardBuckets` builds looks FORWARD of
 * startOfToday — `today` is the day itself, `thisWeek` and `later` are beyond
 * it — and needsAttention's appointment clause only ever tested `scheduled`.
 * So an inspection left `requested` or `confirmed` after its date matched no
 * bucket at all and vanished from /inspections, while `GET /api/inspections`
 * still counted it. The page said "No inspections yet" over open work.
 *
 * `scheduled` never had the problem: that clause's `d <= in48h` has no lower
 * bound, so a past-dated scheduled row was always caught. The asymmetry is
 * what made this hard to see — the status you would reach for while testing
 * is the one status that worked.
 *
 * The boundary is the DAY, not the hour: an inspection at 09:00 is still
 * `today` at 17:00, and becomes overdue at the next UTC midnight.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionAnalyticsService } from '../../../server/services/inspection/inspection-analytics.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000000f2';
const facadeStub = {} as unknown as import('../../../server/services/inspection.service').InspectionService;

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('dashboard buckets — an overdue inspection is never nowhere', () => {
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
            id: TENANT, slug: 'overdueco',
            status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    /** `createdAt` is recent on purpose: the agreement-staleness clause in
     *  needsAttention fires on rows older than 72h and would mask the bucket
     *  under test, letting a broken filter still look green. */
    async function seed(id: string, status: string, dateIso: string) {
        await testDb.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: id,
            date: dateIso, status, paymentStatus: 'unpaid',
            price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
    }

    const bucketsOf = (r: Awaited<ReturnType<InspectionAnalyticsService['getDashboardBuckets']>>, id: string) =>
        (['needsAttention', 'today', 'thisWeek', 'later', 'recentReports', 'cancelled'] as const)
            .filter(k => r[k].some(x => x.id === id));

    for (const status of ['requested', 'confirmed', 'scheduled'] as const) {
        it(`surfaces a ${status} inspection two days past its date`, async () => {
            await seed(`i-${status}`, status, iso(Date.now() - 2 * DAY));
            expect(bucketsOf(await svc.getDashboardBuckets(TENANT), `i-${status}`))
                .toContain('needsAttention');
        });
    }

    // The owner's call, 2026-09-14: overdue ages out after 30 days. Without a
    // floor every never-closed inspection since the workspace began sits in
    // needsAttention at once and stays there, burying this week's real work.
    for (const status of ['requested', 'confirmed', 'scheduled'] as const) {
        it(`lets a ${status} inspection more than 30 days past its date age out of needsAttention`, async () => {
            await seed(`i-stale-${status}`, status, iso(Date.now() - 31 * DAY));
            expect(bucketsOf(await svc.getDashboardBuckets(TENANT), `i-stale-${status}`))
                .not.toContain('needsAttention');
        });
    }

    it('still surfaces an inspection 29 days past its date', async () => {
        await seed('i-29', 'requested', iso(Date.now() - 29 * DAY));
        expect(bucketsOf(await svc.getDashboardBuckets(TENANT), 'i-29'))
            .toContain('needsAttention');
    });

    it('leaves an inspection in today for the whole of its own day, not overdue yet', async () => {
        // 00:30 UTC today — past as an instant, but still this day.
        const startOfToday = new Date(); startOfToday.setUTCHours(0, 30, 0, 0);
        await seed('i-earlier-today', 'requested', startOfToday.toISOString());
        expect(bucketsOf(await svc.getDashboardBuckets(TENANT), 'i-earlier-today'))
            .toContain('today');
    });

    it('does not drag a cancelled inspection back onto the board', async () => {
        await seed('i-cancelled', 'cancelled', iso(Date.now() - 2 * DAY));
        expect(bucketsOf(await svc.getDashboardBuckets(TENANT), 'i-cancelled'))
            .not.toContain('needsAttention');
    });

    it('does not double-report a completed inspection whose report is published', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'i-done', tenantId: TENANT, propertyAddress: 'i-done',
            date: iso(Date.now() - 2 * DAY), status: 'completed', reportStatus: 'published',
            paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        const buckets = bucketsOf(await svc.getDashboardBuckets(TENANT), 'i-done');
        expect(buckets).toContain('recentReports');
        expect(buckets).not.toContain('needsAttention');
    });
});
