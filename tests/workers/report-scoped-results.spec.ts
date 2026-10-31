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
import { InspectionService } from '../../server/services/inspection.service';
import { InspectionPhotoService } from '../../server/services/inspection/inspection-photo.service';
import { projectResults, seedResultsDoc, applyItemPatch } from '../../server/lib/collab/results-doc';
import { resolveResultsRow } from '../../server/services/inspection/report-grain';
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

    describe('a row with no report id belongs to the primary report', () => {
        interface DOInternals {
            doc: Y.Doc; tenantId: string | null; inspectionId: string | null; reportId: string | null;
            hadStoredState: boolean; hydrateFromD1Once(): Promise<void>; persist(): Promise<void>;
            persistTimer: ReturnType<typeof setTimeout> | null;
            ctx: { storage: { deleteAlarm(): Promise<void> } };
            captureSnapshot(by: string | null, reason: string): Promise<{ seq: number }>;
            restoreSnapshot(seq: number, by: string | null): Promise<{ ok: boolean }>;
        }
        const withDO = <T,>(name: string, reportId: string | null, fn: (o: DOInternals) => Promise<T>) => {
            const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(name));
            return runInDurableObject(stub, async (inst) => {
                const o = inst as unknown as DOInternals;
                o.tenantId = TENANT; o.inspectionId = INSPECTION; o.reportId = reportId;
                try {
                    return await fn(o);
                } finally {
                    // A document schedules a debounced persist (timer + alarm) on every update. Left pending
                    // it fires during a LATER test, after beforeEach cleared the tables, and inserts its own
                    // row there. Cancel both so each test only sees the writes it made.
                    if (o.persistTimer !== null) { clearTimeout(o.persistTimer); o.persistTimer = null; }
                    await o.ctx.storage.deleteAlarm();
                }
            });
        };
        const ratingOf = (doc: Y.Doc) => (projectResults(doc) as Record<string, { rating?: string }>)[KEY]?.rating;
        const rows = async () => (await b.DB.prepare('SELECT id, report_id FROM inspection_results ORDER BY id').all<{ id: string; report_id: string | null }>()).results;
        const addAncillary = () => db().insert(schema.reports).values(
            { id: SECONDARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'ancillary', title: 'Radon', createdAt: new Date() });
        const addNullRow = (id: string, data: unknown) => db().insert(schema.inspectionResults).values(
            { id, tenantId: TENANT, inspectionId: INSPECTION, reportId: null, data: data as object, lastSyncedAt: new Date() });

        it('is used by the primary report, with no sibling row', async () => {
            await seed({ legacyNullRow: true });
            await photoService().detachItemPhoto(INSPECTION, TENANT, KEY, 0);
            const stored = JSON.parse(await rawData('row-primary'));
            expect(stored[KEY].photos.map((p: { key: string }) => p.key)).toEqual(['p2']);
        });

        it('lifecycle: ancillary opens first, then primary; every reader sees the same data and one row remains per report', async () => {
            await seed({ legacyNullRow: true });
            await addAncillary();

            // The ancillary document opens first. It never imports the NULL row, and its persist inserts its own row.
            const anc = await withDO('doc-anc', SECONDARY, async (o) => { await o.hydrateFromD1Once(); const r = ratingOf(o.doc); await o.persist(); return r; });
            expect(anc).toBeUndefined();
            expect((await rows()).map((r) => r.report_id ?? '').sort()).toEqual(['', SECONDARY]);

            // Then the primary: it imports the NULL row's data and adopts the row on persist.
            const prim = await withDO('doc-prim', PRIMARY, async (o) => { await o.hydrateFromD1Once(); const r = ratingOf(o.doc); await o.persist(); return r; });
            expect(prim).toBe('satisfactory');
            const after = await rows();
            expect(after.map((r) => r.report_id).sort()).toEqual([PRIMARY, SECONDARY]);
            expect(after.find((r) => r.report_id === PRIMARY)?.id).toBe('row-primary');

            // Photo route, snapshot and render all land on that same row.
            await photoService().reorderItemPhotos(INSPECTION, TENANT, KEY, ['p2', 'p1']);
            const stored = JSON.parse(await rawData('row-primary'));
            expect(stored[KEY].photos.map((p: { key: string }) => p.key)).toEqual(['p2', 'p1']);
            const svc = new ReportVersionService(b.DB, 'test-key-encryption-secret-0123456789');
            await svc.snapshotOnPublish(TENANT, INSPECTION, 'u1', undefined, PRIMARY);
            const v = await db().select().from(schema.reportVersions).where(eq(schema.reportVersions.reportId, PRIMARY)).get();
            expect(JSON.parse(v!.snapshotJson).data[KEY].photos.map((p: { key: string }) => p.key)).toEqual(['p2', 'p1']);
            expect((await resolveResultsRow(db(), TENANT, INSPECTION, PRIMARY))?.id).toBe('row-primary');
            expect(await rows()).toHaveLength(2);
        });

        it('an ancillary report never reads a NULL row, in any reader', async () => {
            await seed({ legacyNullRow: true });
            await addAncillary();
            expect(await resolveResultsRow(db(), TENANT, INSPECTION, SECONDARY)).toBeNull();
            const svc = new ReportVersionService(b.DB, 'test-key-encryption-secret-0123456789');
            await svc.snapshotOnPublish(TENANT, INSPECTION, 'u1', undefined, SECONDARY);
            const v = await db().select().from(schema.reportVersions).where(eq(schema.reportVersions.reportId, SECONDARY)).get();
            expect(JSON.parse(v!.snapshotJson).data).toEqual({});
        });

        it('primary adoption updates the NULL row in place instead of inserting a second', async () => {
            await seed({ legacyNullRow: true });
            await withDO('doc-adopt', PRIMARY, async (o) => { await o.hydrateFromD1Once(); await o.persist(); });
            expect(await rows()).toEqual([{ id: 'row-primary', report_id: PRIMARY }]);
        });

        it('two NULL rows are ambiguous: the photo routes answer a coded 409 and hydrate imports nothing', async () => {
            await seed({ legacyNullRow: true });
            await addNullRow('row-null-2', PRIMARY_DATA);
            await expect(photoService().detachItemPhoto(INSPECTION, TENANT, KEY, 0)).rejects.toMatchObject({
                status: 409, details: { reason: 'ambiguous_results_rows' },
            });
            const imported = await withDO('doc-ambig', PRIMARY, async (o) => { await o.hydrateFromD1Once(); return ratingOf(o.doc); });
            expect(imported).toBeUndefined();
        });

        it('attach with no primary report and no row inserts a NULL row instead of refusing', async () => {
            await db().insert(schema.tenants).values({
                id: TENANT, slug: 'acme-c1', status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
            });
            await db().insert(schema.inspections).values({
                id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Birch Ln', date: '2026-06-01',
                status: 'requested', paymentStatus: 'unpaid', price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            });
            await db().insert(schema.inspectionMediaPool).values({
                id: 'pool1', inspectionId: INSPECTION, tenantId: TENANT, r2Key: 'pool-key', url: '/x', uploadedAt: new Date(),
            });
            await photoService().attachPoolPhoto(INSPECTION, TENANT, 'pool1', KEY);
            const all = await rows();
            expect(all).toHaveLength(1);
            expect(all[0].report_id).toBeNull();
            // The primary report, created later, owns that row.
            await db().insert(schema.reports).values(
                { id: PRIMARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary', title: 'Inspection Report', createdAt: new Date() });
            expect((await resolveResultsRow(db(), TENANT, INSPECTION, PRIMARY))?.id).toBe(all[0].id);
        });

        it('a named report that has only a sibling row starts empty', async () => {
            await seed();
            const out = await withDO('doc-sibling', SECONDARY, async (o) => { await o.hydrateFromD1Once(); return ratingOf(o.doc); });
            expect(out).toBe('defect'); // its own row
            await b.DB.prepare('DELETE FROM inspection_results WHERE id = ?').bind('row-secondary').run();
            const empty = await withDO('doc-sibling-2', SECONDARY, async (o) => { await o.hydrateFromD1Once(); return ratingOf(o.doc); });
            expect(empty).toBeUndefined();
        });

        it('a document with stored state is not reset by a hydrate that finds no row', async () => {
            await seed();
            await b.DB.prepare('DELETE FROM inspection_results WHERE id = ?').bind('row-secondary').run();
            const live = await withDO('doc-live', SECONDARY, async (o) => {
                seedResultsDoc(o.doc, [{ findingKey: KEY }]);
                applyItemPatch(o.doc, KEY, 'rating', 'LIVE');
                o.hadStoredState = true;
                await o.hydrateFromD1Once();
                return ratingOf(o.doc);
            });
            expect(live).toBe('LIVE');
        });

        it('revert acts on the primary row and leaves the sibling byte-identical', async () => {
            await seed({ primaryData: { [KEY]: { photos: [{ key: 'p1', annotatedKey: 'p1-annot', annotationsJson: '{}' }] } } });
            const before = await rawData('row-secondary');
            await photoService().revertPhotoEdits(INSPECTION, TENANT, KEY, 0);
            expect(await rawData('row-secondary')).toBe(before);
            const stored = JSON.parse(await rawData('row-primary'));
            expect(stored[KEY].photos[0].annotatedKey).toBeUndefined();
        });

        it('a primary row stays 404 for detach when the inspection has no row at all', async () => {
            await seed();
            await b.DB.prepare('DELETE FROM inspection_results WHERE id = ?').bind('row-primary').run();
            await expect(photoService().detachItemPhoto(INSPECTION, TENANT, KEY, 0)).rejects.toMatchObject({ status: 404 });
        });

        describe('persist', () => {
            const dataOf = async (id: string) => JSON.parse(await rawData(id)) as Record<string, { rating?: string }>;
            const filledDO = (o: DOInternals) => { seedResultsDoc(o.doc, [{ findingKey: KEY }]); applyItemPatch(o.doc, KEY, 'rating', 'LIVE'); };

            it('with two NULL rows writes nothing: both rows stay byte-identical and no third appears', async () => {
                await seed({ legacyNullRow: true });
                await addNullRow('row-null-2', { [KEY]: { rating: 'other' } });
                const before = await b.DB.prepare('SELECT * FROM inspection_results ORDER BY id').all();
                await withDO('doc-ambig-persist', PRIMARY, async (o) => { filledDO(o); await o.persist(); });
                expect((await b.DB.prepare('SELECT * FROM inspection_results ORDER BY id').all()).results).toEqual(before.results);
            });

            it('a lost claim re-resolves to the winner\'s row: no insert, no unique-key failure', async () => {
                await seed({ legacyNullRow: true });
                await Promise.all(['doc-race-a', 'doc-race-b'].map((n) => withDO(n, PRIMARY, async (o) => {
                    await o.hydrateFromD1Once(); await o.persist();
                })));
                expect(await rows()).toEqual([{ id: 'row-primary', report_id: PRIMARY }]);
                expect((await dataOf('row-primary'))[KEY]?.rating).toBe('satisfactory');
            });

            it('a double-encoded NULL row hydrates, is claimed, and keeps its content', async () => {
                await seed({ legacyNullRow: true, primaryData: JSON.stringify(PRIMARY_DATA) });
                const seen = await withDO('doc-double', PRIMARY, async (o) => { await o.hydrateFromD1Once(); const r = ratingOf(o.doc); await o.persist(); return r; });
                expect(seen).toBe('satisfactory');
                expect(await rows()).toEqual([{ id: 'row-primary', report_id: PRIMARY }]);
                expect((await dataOf('row-primary'))[KEY]?.rating).toBe('satisfactory');
            });

            const allRows = async () => (await b.DB.prepare('SELECT * FROM inspection_results ORDER BY id').all()).results;

            describe('a document that holds nothing is saved as nothing', () => {
                it('the last finding cleared persists {}, and render and snapshot read {}', async () => {
                    await seed();
                    await withDO('doc-cleared', PRIMARY, async (o) => { o.hadStoredState = true; await o.persist(); });
                    expect(await dataOf('row-primary')).toEqual({});
                    expect((await resolveResultsRow(db(), TENANT, INSPECTION, PRIMARY))?.data).toEqual({});
                    const svc = new ReportVersionService(b.DB, 'test-key-encryption-secret-0123456789');
                    await svc.snapshotOnPublish(TENANT, INSPECTION, 'u1', undefined, PRIMARY);
                    const snap = await db().select().from(schema.reportVersions).where(eq(schema.reportVersions.reportId, PRIMARY)).get();
                    expect(JSON.parse(snap!.snapshotJson).data).toEqual({});
                });

                it('the same holds over an unassigned row the document claims', async () => {
                    await seed({ legacyNullRow: true });
                    await withDO('doc-cleared-null', PRIMARY, async (o) => { o.hadStoredState = true; await o.persist(); });
                    expect(await rows()).toEqual([{ id: 'row-primary', report_id: PRIMARY }]);
                    expect(await dataOf('row-primary')).toEqual({});
                });

                it('restoring a {} snapshot persists {}', async () => {
                    await seed();
                    await withDO('doc-restore-empty', PRIMARY, async (o) => {
                        const snap = await o.captureSnapshot(null, 'manual');
                        filledDO(o);
                        await o.persist();
                        expect((await dataOf('row-primary'))[KEY]?.rating).toBe('LIVE');
                        await o.restoreSnapshot(snap.seq, null);
                    });
                    expect(await dataOf('row-primary')).toEqual({});
                });
            });

            describe('a row whose stored data cannot be read', () => {
                const corrupt = (id: string) => b.DB.prepare("UPDATE inspection_results SET data = '{oops' WHERE id = ?").bind(id).run();

                it('hydrates empty, and persist leaves the row byte-identical (report_id included)', async () => {
                    await seed({ legacyNullRow: true });
                    await corrupt('row-primary');
                    const before = await allRows();
                    const seen = await withDO('doc-bad', PRIMARY, async (o) => {
                        await o.hydrateFromD1Once();
                        const r = ratingOf(o.doc);
                        filledDO(o);
                        await o.persist();
                        return r;
                    });
                    expect(seen).toBeUndefined();
                    expect(await allRows()).toEqual(before);
                });

                it('the photo routes and updateResults answer a coded 409 and write nothing', async () => {
                    await seed();
                    await corrupt('row-primary');
                    const before = await allRows();
                    await expect(photoService().detachItemPhoto(INSPECTION, TENANT, KEY, 0))
                        .rejects.toMatchObject({ status: 409, details: { reason: 'unreadable_results_row' } });
                    await expect(new InspectionService(b.DB).updateResults(INSPECTION, TENANT, { [KEY]: { rating: 'x' } }))
                        .rejects.toMatchObject({ status: 409, details: { reason: 'unreadable_results_row' } });
                    expect(await allRows()).toEqual(before);
                });
            });

            describe('a document with no report id', () => {
                it('writes nothing to D1 while several rows exist; once it carries an identity the next persist writes', async () => {
                    await seed();
                    const before = await allRows();
                    await withDO('doc-no-report-persist', null, async (o) => { filledDO(o); await o.persist(); });
                    expect(await allRows()).toEqual(before);
                    await withDO('doc-no-report-persist', PRIMARY, async (o) => { await o.persist(); });
                    expect((await dataOf('row-primary'))[KEY]?.rating).toBe('LIVE');
                    expect((await dataOf('row-secondary'))[KEY]?.rating).toBe('defect');
                    expect(await rows()).toHaveLength(2);
                });
            });
        });

        it('a moved reader (auto-sign) writes the primary row, not the sibling inserted first', async () => {
            await seed();
            await b.DB.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, default_signature_base64, created_at) VALUES ('u-sign', ?, 's@x.test', 'x', 'inspector', 'data:image/png;base64,AAAA', 0)").bind(TENANT).run();
            await db().update(schema.inspections).set({ autoSignOnPublish: true, inspectorId: 'u-sign' }).where(eq(schema.inspections.id, INSPECTION));
            const sibling = await rawData('row-secondary');
            const { applyAutoSignatureOnPublish } = await import('../../server/lib/inspection/auto-sign');
            await applyAutoSignatureOnPublish(db(), TENANT, INSPECTION);
            expect(await rawData('row-secondary')).toBe(sibling);
            expect(JSON.parse(await rawData('row-primary'))._inspector_signature).toBeTruthy();
        });
    });
});
