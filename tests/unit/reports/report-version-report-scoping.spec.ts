/**
 * Version chains are per REPORT. The reads were per INSPECTION.
 *
 * `snapshotOnPublish` already scopes its previous-version lookup by reportId and
 * stamps reportId on the row it writes — two deliverables on one order publish
 * independently and each keeps its own chain, both starting at 1. But
 * `getLatestPublished`, `get`, `list` and `loadPinnedSnapshot` filtered on
 * tenant + inspection only, so `ORDER BY version_number DESC LIMIT 1` crossed
 * the chains: the radon report's v2 outranked the standard report's v1, and
 * `public-report.ts` pinned the standard report's page to it. Multi-report is
 * not hypothetical — the cron generates one report per sold service line
 * (server/lib/inspection/report-generation.ts).
 *
 * The legacy case is asserted too: rows written before the reports entity
 * existed carry reportId NULL, and they must stay visible — there was only one
 * deliverable then, so they can only have been this one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportVersionService } from '../../../server/services/report-version.service';
import { loadPinnedSnapshot } from '../../../server/lib/report-snapshot';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT     = '00000000-0000-0000-0000-0000000000aa';
const INSPECTION = '11111111-1111-1111-1111-1111111111aa';
const PRIMARY    = 'report-primary-aa';
const ANCILLARY  = 'report-ancillary-aa';

describe('report_versions reads are scoped to one deliverable', () => {
    let svc: ReportVersionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme-scoping', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        // The home inspection and the radon report on the same order.
        await testDb.insert(schema.reports).values([
            { id: PRIMARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary',
              title: 'Inspection Report', status: 'in_progress', createdAt: new Date() },
            { id: ANCILLARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'ancillary',
              title: 'Radon Report', status: 'in_progress', createdAt: new Date() },
        ] as never);
        svc = new ReportVersionService({} as D1Database, 'test-encryption-secret-key');

        // Radon ships twice (v1, then an amendment v2); the standard report once.
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a', 'radon v1', ANCILLARY);
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a', 'radon v2', ANCILLARY);
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a', 'primary v1', PRIMARY);
    });

    it('list returns only the named report’s versions', async () => {
        expect((await svc.list(TENANT, INSPECTION, ANCILLARY)).map(v => v.summary)).toEqual(['radon v2', 'radon v1']);
        expect((await svc.list(TENANT, INSPECTION, PRIMARY)).map(v => v.summary)).toEqual(['primary v1']);
    });

    it('getLatestPublished does not let the other report’s higher version win', async () => {
        // The bug: v2 came back here, so public-report.ts pinned the standard
        // report's page to the radon report's frozen row — including the
        // verification token and content hash shown to the reader.
        expect((await svc.getLatestPublished(TENANT, INSPECTION, PRIMARY))?.versionNumber).toBe(1);
        expect((await svc.getLatestPublished(TENANT, INSPECTION, ANCILLARY))?.versionNumber).toBe(2);
    });

    it('omitting the reportId means the PRIMARY, not whichever row sorts first', async () => {
        expect((await svc.getLatestPublished(TENANT, INSPECTION))?.versionNumber).toBe(1);
        expect((await svc.list(TENANT, INSPECTION)).map(v => v.summary)).toEqual(['primary v1']);
    });

    it('get refuses a version that belongs to the other report', async () => {
        expect(await svc.get(TENANT, INSPECTION, 2, PRIMARY)).toBeNull();
        expect(await svc.get(TENANT, INSPECTION, 1, PRIMARY)).not.toBeNull();
        expect(await svc.get(TENANT, INSPECTION, 2, ANCILLARY)).not.toBeNull();
    });

    it('loadPinnedSnapshot refuses a version that belongs to the other report', async () => {
        expect(await loadPinnedSnapshot(testDb as never, TENANT, INSPECTION, 2, PRIMARY)).toBeNull();
        expect(await loadPinnedSnapshot(testDb as never, TENANT, INSPECTION, 1, PRIMARY)).not.toBeNull();
    });

});

describe('pre-reports-entity versions stay readable', () => {
    let svc: ReportVersionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme-legacy', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await testDb.insert(schema.reports).values([
            { id: PRIMARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary',
              title: 'Inspection Report', status: 'in_progress', createdAt: new Date() },
        ] as never);
        // A row as it was written before reports existed: no reportId at all.
        await testDb.insert(schema.reportVersions).values({
            id: 'ver-legacy', tenantId: TENANT, inspectionId: INSPECTION,
            versionNumber: 3, snapshotJson: JSON.stringify({ schemaVersion: 1, inspection: { id: INSPECTION } }),
            summary: 'legacy v3', contentHash: 'hash-legacy', isAmendment: true,
            verificationToken: 'token-legacy', publishedAt: new Date(), publishedBy: 'user-a',
            createdAt: new Date(), reportId: null,
        } as never);
        svc = new ReportVersionService({} as D1Database, 'test-encryption-secret-key');
    });

    it('a NULL reportId row is still the primary report’s history', async () => {
        // Scoping strictly by reportId would hide every version an install
        // published before the reports entity landed — the version list would go
        // empty and the public report would silently stop pinning.
        expect((await svc.getLatestPublished(TENANT, INSPECTION))?.versionNumber).toBe(3);
        expect((await svc.list(TENANT, INSPECTION)).map(v => v.summary)).toEqual(['legacy v3']);
        expect(await svc.get(TENANT, INSPECTION, 3)).not.toBeNull();
        expect(await loadPinnedSnapshot(testDb as never, TENANT, INSPECTION, 3)).not.toBeNull();
    });
});
