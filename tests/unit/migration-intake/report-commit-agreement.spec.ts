/**
 * The review's verdict has to agree with what apply will actually accept.
 *
 * `describeRowProblem`'s template branch used to check only that `name` and
 * `schema.sections` were non-empty — far weaker than the `.strict()`
 * `TemplateSchemaV2Schema` the writer runs through `TemplateService.validateSchema`
 * (server/services/template.service.ts, called from row-writers.ts). A row shaped
 * to pass the weak check but fail the real one read as "ready to import" on the
 * review screen (`MigrationReportService.build` — counts.problems, blockedReason)
 * and was then refused at commit, reported only as a generic per-row failure.
 *
 * The two shipped adapters (home-inspector-pro, spectora) always emit
 * schema-valid output, and `parseMigrationBundle` re-validates every template
 * against the full schema before a normal upload is ever staged — so the gap is
 * unreachable through an upload. It IS reachable through the repair endpoint
 * (`PATCH .../rows/:rowId`, `MigrationRepairService.repairRow`), which accepts an
 * arbitrary `payload: z.unknown()` and writes it straight to staging, checked
 * only by `describeRowProblem`. This spec reproduces that path end to end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';
import type { BundleTemplate, EntityCounts, MigrationBundleV1 } from '../../../server/lib/migration-intake/bundle';
import type { TemplateSchemaV2 } from '../../../server/types/template-schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { MigrationReportService } from '../../../server/services/migration-intake/report.service';
import { MigrationApplyService } from '../../../server/services/migration-intake/apply.service';
import { MigrationRepairService } from '../../../server/services/migration-intake/repair.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);
const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

const VALID_SCHEMA: TemplateSchemaV2 = {
    schemaVersion: 2,
    sections: [{ id: 'sec_a', title: 'Roof', items: [] }],
};
const STATS: BundleTemplate['stats'] = {
    sections: 1, items: 0, information: 0, limitations: 0, defects: 0, unknownCommentTypes: [],
};

function templateBundle(): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'spectora' },
            adapter: { name: 'spectora', version: '1' },
            counts: {
                template: { readFromSource: 1, emitted: 1, dropped: [] },
                contact: EMPTY,
                member: EMPTY,
            },
            warnings: [],
        },
        templates: [{ name: 'Imported', schema: VALID_SCHEMA, stats: STATS }],
        contacts: [],
        members: [],
    };
}

describe('the review agrees with what commit accepts — templates', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let stage: MigrationStageService;
    let report: MigrationReportService;
    let apply: MigrationApplyService;
    let repair: MigrationRepairService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // The staging step batches its writes, and better-sqlite3 is the one
        // Drizzle driver with no `batch()` — see helpers/d1-binding.ts.
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        stage = new MigrationStageService({} as D1Database);
        report = new MigrationReportService({} as D1Database, {} as R2Bucket);
        apply = new MigrationApplyService({} as D1Database);
        repair = new MigrationRepairService({} as D1Database, {} as R2Bucket);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('flags a hand-repaired row whose schema version the writer rejects, rather than calling the run ready', async () => {
        const staged = await stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'templates.create',
            bundle: templateBundle(),
        });
        const rowId = staged.rows[0].id;

        // The operator hand-repairs the row through the wizard's raw editor.
        // The repair endpoint accepts `payload: z.unknown()`, and this payload
        // still has a non-empty name and a non-empty sections array — all the
        // OLD check looked at — but the wrong schema version, which
        // `TemplateSchemaV2Schema` (and so the writer) refuses outright.
        const repaired = await repair.repairRow({
            tenantId: TENANT, batchId: staged.batchId, rowId,
            payload: {
                name: 'Imported',
                schema: { schemaVersion: 99, sections: [{ id: 's', title: 'Roof', items: [] }] },
                stats: STATS,
            },
        });
        expect(repaired.resolved).toBe(false);

        const r = await report.build({ tenantId: TENANT, batchId: staged.batchId, seatQuotaEnforced: false });
        expect(r.counts).toEqual({ total: 1, ok: 0, conflicts: 0, problems: 1 });
        expect(r.blockedReason).toMatch(/1 entry/);
        expect(r.problemRows[0].field).toMatch(/^schema/);
        expect(r.problemRows[0].reason).toBeTruthy();

        // Positive control: what the review now refuses is exactly what commit
        // would have refused anyway — the two paths agree.
        const applied = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(applied.failed).toBe(1);
        expect(applied.applied).toBe(0);
    });
});
