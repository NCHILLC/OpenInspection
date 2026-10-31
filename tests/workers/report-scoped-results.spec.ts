/**
 * An inspection can deliver several reports, and `inspection_results` holds one
 * row per report. These specs insert the SECONDARY report's row first, so a read
 * or write keyed by inspection alone lands on the wrong document.
 *
 * Real workerd, real D1 (migrations replayed), real Durable Object.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import * as schema from '../../server/lib/db/schema';
import { ReportVersionService } from '../../server/services/report-version.service';
import { InspectionPhotoService } from '../../server/services/inspection/inspection-photo.service';
import { projectResults } from '../../server/lib/collab/results-doc';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import { applyMigrations as replayMigrations } from './migration-replay';

const b = env as unknown as { DB: D1Database; INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO> };

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const INSPECTION = '11111111-1111-1111-1111-1111111111c1';
const PRIMARY = 'report-primary';
const SECONDARY = 'report-secondary';
const KEY = '_default:sec1:item1';

const migrationSql = import.meta.glob('../../migrations/*.sql', {
    query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const photo = (k: string) => ({ key: k });
const PRIMARY_DATA = { [KEY]: { rating: 'satisfactory', photos: [photo('p1'), photo('p2')] } };
const SECONDARY_DATA = { [KEY]: { rating: 'defect', photos: [photo('s1'), photo('s2')] } };

const db = () => drizzle(b.DB);

async function seed(opts: { primaryData?: unknown; secondaryData?: unknown; legacyNullRow?: boolean } = {}) {
    await db().insert(schema.tenants).values({
        id: TENANT, slug: 'acme-c1', status: 'active', deploymentMode: 'shared',
        tier: 'free', maxUsers: 5, createdAt: new Date(),
    });
    await db().insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Birch Ln', date: '2026-06-01',
        status: 'requested', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
    if (!opts.legacyNullRow) {
        await db().insert(schema.reports).values([
            { id: PRIMARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary', title: 'Inspection Report', createdAt: new Date() },
            { id: SECONDARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'ancillary', title: 'Radon', createdAt: new Date() },
        ]);
    } else {
        await db().insert(schema.reports).values(
            { id: PRIMARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary', title: 'Inspection Report', createdAt: new Date() });
    }
    // Secondary FIRST: an unscoped read returns the first row inserted.
    if (!opts.legacyNullRow) {
        await db().insert(schema.inspectionResults).values({
            id: 'row-secondary', tenantId: TENANT, inspectionId: INSPECTION, reportId: SECONDARY,
            data: (opts.secondaryData ?? SECONDARY_DATA) as object, lastSyncedAt: new Date(),
        });
    }
    await db().insert(schema.inspectionResults).values({
        id: 'row-primary', tenantId: TENANT, inspectionId: INSPECTION,
        reportId: opts.legacyNullRow ? null : PRIMARY,
        data: (opts.primaryData ?? PRIMARY_DATA) as object, lastSyncedAt: new Date(),
    });
}

/** The raw stored text, which is what "decodes on one parse" is about. */
async function rawData(id: string): Promise<string> {
    const r = await b.DB.prepare('SELECT data FROM inspection_results WHERE id = ?').bind(id).first<{ data: string }>();
    return r!.data;
}

function photoService() {
    const facade = { getInspection: async () => ({}) };
    return new InspectionPhotoService(b.DB, undefined, undefined, undefined, undefined, facade as never);
}

describe('results are read and written for one report', () => {
    beforeAll(() => replayMigrations(b.DB, migrationSql));
    beforeEach(async () => {
        for (const t of ['inspection_media_pool', 'report_versions', 'signing_keys', 'inspection_results', 'reports', 'inspection_units', 'inspections', 'tenants']) {
            await b.DB.exec(`DELETE FROM ${t};`);
        }
    });

    describe('collaboration document hydrate', () => {
        interface DOInternals { doc: Y.Doc; tenantId: string | null; inspectionId: string | null; reportId: string | null; hydrateFromD1Once(): Promise<void> }
        async function hydrated(name: string, reportId: string | null) {
            const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(name));
            return runInDurableObject(stub, async (inst) => {
                const o = inst as unknown as DOInternals;
                o.tenantId = TENANT; o.inspectionId = INSPECTION; o.reportId = reportId;
                await o.hydrateFromD1Once();
                return projectResults(o.doc);
            });
        }

        it('a fresh document imports its own report, not the first row on the inspection', async () => {
            await seed();
            const p = await hydrated('doc-primary', PRIMARY);
            expect((p as Record<string, { rating?: string }>)[KEY]?.rating).toBe('satisfactory');
            const s = await hydrated('doc-secondary', SECONDARY);
            expect((s as Record<string, { rating?: string }>)[KEY]?.rating).toBe('defect');
        });

        it('with no report id nothing is imported', async () => {
            await seed();
            const out = await hydrated('doc-no-report', null);
            expect(Object.keys(out)).toEqual([]);
        });
    });

    describe('snapshotOnPublish', () => {
        it('each report freezes its own data', async () => {
            await seed();
            const svc = new ReportVersionService(b.DB, 'test-key-encryption-secret-0123456789');
            await svc.snapshotOnPublish(TENANT, INSPECTION, 'u1', undefined, SECONDARY);
            await svc.snapshotOnPublish(TENANT, INSPECTION, 'u1', undefined, PRIMARY);
            const snap = async (reportId: string) => {
                const r = await db().select().from(schema.reportVersions)
                    .where(eq(schema.reportVersions.reportId, reportId)).get();
                return JSON.parse(r!.snapshotJson).data as Record<string, { rating?: string }>;
            };
            expect((await snap(SECONDARY))[KEY]?.rating).toBe('defect');
            expect((await snap(PRIMARY))[KEY]?.rating).toBe('satisfactory');
        });

        it('with no report named it freezes the primary report', async () => {
            await seed();
            const svc = new ReportVersionService(b.DB, 'test-key-encryption-secret-0123456789');
            await svc.snapshotOnPublish(TENANT, INSPECTION, 'u1');
            const r = await db().select().from(schema.reportVersions).get();
            expect(JSON.parse(r!.snapshotJson).data[KEY].rating).toBe('satisfactory');
        });
    });

    describe('legacy photo routes act on the primary report only', () => {
        it('reorder changes the primary row and leaves the sibling byte-identical', async () => {
            await seed();
            const before = await rawData('row-secondary');
            await photoService().reorderItemPhotos(INSPECTION, TENANT, KEY, ['p2', 'p1']);
            expect(await rawData('row-secondary')).toBe(before);
            const stored = JSON.parse(await rawData('row-primary')); // ONE parse -> object
            expect(typeof stored).toBe('object');
            expect(stored[KEY].photos.map((p: { key: string }) => p.key)).toEqual(['p2', 'p1']);
        });

        it('a double-encoded row is read, and written back as an object', async () => {
            await seed({ primaryData: JSON.stringify(PRIMARY_DATA) });
            expect(typeof JSON.parse(await rawData('row-primary'))).toBe('string');
            await photoService().detachItemPhoto(INSPECTION, TENANT, KEY, 0);
            const stored = JSON.parse(await rawData('row-primary'));
            expect(typeof stored).toBe('object');
            expect(stored[KEY].photos.map((p: { key: string }) => p.key)).toEqual(['p2']);
        });

        it('move touches only the primary row', async () => {
            await seed({ primaryData: { a: { photos: [photo('p1')] }, b: { photos: [] } } });
            const before = await rawData('row-secondary');
            await photoService().moveItemPhoto(INSPECTION, TENANT, 'a', 0, 'b');
            expect(await rawData('row-secondary')).toBe(before);
            const stored = JSON.parse(await rawData('row-primary'));
            expect(stored.a.photos).toEqual([]);
            expect(stored.b.photos.map((p: { key: string }) => p.key)).toEqual(['p1']);
        });

        it('attach appends to the primary row and leaves the sibling alone', async () => {
            await seed();
            await db().insert(schema.inspectionMediaPool).values({
                id: 'pool1', inspectionId: INSPECTION, tenantId: TENANT, r2Key: 'pool-key',
                url: '/x', uploadedAt: new Date(),
            });
            const before = await rawData('row-secondary');
            await photoService().attachPoolPhoto(INSPECTION, TENANT, 'pool1', KEY);
            expect(await rawData('row-secondary')).toBe(before);
            const stored = JSON.parse(await rawData('row-primary'));
            expect(stored[KEY].photos.map((p: { key: string }) => p.key)).toEqual(['p1', 'p2', 'pool-key']);
        });
    });

    describe('a row with no report id', () => {
        it('is used when it is the only row of the inspection', async () => {
            await seed({ legacyNullRow: true });
            await photoService().detachItemPhoto(INSPECTION, TENANT, KEY, 0);
            const stored = JSON.parse(await rawData('row-primary'));
            expect(stored[KEY].photos.map((p: { key: string }) => p.key)).toEqual(['p2']);
        });

        it('is not guessed at when another row exists', async () => {
            await seed();
            await b.DB.prepare('UPDATE inspection_results SET report_id = NULL WHERE id = ?').bind('row-primary').run();
            await expect(photoService().detachItemPhoto(INSPECTION, TENANT, KEY, 0)).rejects.toMatchObject({ status: 404 });
        });
    });
});
