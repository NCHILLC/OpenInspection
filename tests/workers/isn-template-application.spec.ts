import { env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import * as schema from '../../server/lib/db/schema';
import { applyMigrations } from './migration-replay';
import { collabDocName } from '../../server/lib/collab/doc-name';
import { applyItemPatch } from '../../server/lib/collab/results-doc';
import { applyIsnTemplate } from '../../server/services/isn/template-application';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';

const b = env as unknown as { DB: D1Database; INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO> };
const migrationSql = import.meta.glob('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const db = drizzle(b.DB);
let tenant: string;
let inspection: string;
let report: string;
let oldTemplate: string;
let newTemplate: string;
let stub: DurableObjectStub<InspectionDocDO>;
const headers = () => ({ 'x-tenant-id': tenant, 'x-inspection-id': inspection, 'x-report-id': report });
const apply = () => stub.fetch('https://do/isn-template', { method: 'POST', headers: headers() });
const inspectionRow = () => db.select().from(schema.inspections).where(and(eq(schema.inspections.id, inspection), eq(schema.inspections.tenantId, tenant))).get();

beforeAll(async () => { await applyMigrations(b.DB, migrationSql); });
beforeEach(async () => {
    tenant = crypto.randomUUID(); inspection = crypto.randomUUID(); report = crypto.randomUUID();
    oldTemplate = crypto.randomUUID(); newTemplate = crypto.randomUUID();
    const now = new Date();
    await db.insert(schema.tenants).values({ id: tenant, slug: tenant, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now });
    const snapshot = (label: string) => ({ schemaVersion: 2, sections: [{ id: 'general', title: label, items: [{ id: 'roof', label: 'Roof', type: 'rich', ratingOptions: ['Inspected'], tabs: { information: [], limitations: [], defects: [] } }] }] });
    await db.insert(schema.templates).values([
        { id: oldTemplate, tenantId: tenant, name: 'Old', schema: snapshot('Old section'), version: 1, createdAt: now },
        { id: newTemplate, tenantId: tenant, name: 'Mapped', schema: snapshot('Mapped section'), version: 4, createdAt: now },
    ]);
    await db.insert(schema.inspections).values({ id: inspection, tenantId: tenant, propertyAddress: '1 Main St', date: '2026-11-06', templateId: oldTemplate, templateSnapshot: snapshot('Old section'), templateSnapshotVersion: 1, createdAt: now });
    await db.insert(schema.reports).values({ id: report, tenantId: tenant, inspectionId: inspection, kind: 'primary', title: 'Inspection Report', templateId: oldTemplate, createdAt: now });
    await db.insert(schema.inspectionResults).values({ id: `results-${report}`, tenantId: tenant, inspectionId: inspection, reportId: report, data: {}, lastSyncedAt: now, ratingSystemSnapshot: { old: true } });
    await db.insert(schema.isnOrders).values({ id: crypto.randomUUID(), tenantId: tenant, isnOrderId: crypto.randomUUID(), inspectionId: inspection, payload: { ordertype: 'home' }, fetchedAt: now });
    await db.insert(schema.isnOrderTypeTemplates).values({ id: crypto.randomUUID(), tenantId: tenant, isnOrderTypeId: 'home', templateId: newTemplate, createdAt: now, updatedAt: now });
    stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(collabDocName(tenant, report)));
});

describe('apply ISN template in the primary document concurrency gate', () => {
    it('updates snapshot, report pointer and results atomically; competing repeats are safe', async () => {
        const responses = await Promise.all([apply(), apply()]);
        expect(responses.map((response) => response.status)).toEqual([200, 200]);
        expect((await Promise.all(responses.map((response) => response.json() as Promise<{ changed: boolean }>))).map((body) => body.changed).sort()).toEqual([false, true]);
        expect(await inspectionRow()).toMatchObject({ templateId: newTemplate, templateSnapshotVersion: 4 });
        expect((await inspectionRow())?.templateSnapshot).toMatchObject({ sections: [{ title: 'Mapped section' }] });
        expect(await db.select().from(schema.reports).where(eq(schema.reports.id, report)).get()).toMatchObject({ id: report, templateId: newTemplate });
        expect(await db.select().from(schema.inspectionResults).where(eq(schema.inspectionResults.reportId, report)).get()).toMatchObject({ id: `results-${report}`, data: {}, ydocState: null, ratingSystemSnapshot: null });
    });

    it.each([
        ['rating', { roof: { rating: 'Inspected' } }],
        ['notes', { roof: { notes: 'Inspector writing' } }],
        ['photo', { roof: { photos: [{ key: 'photo-key' }] } }],
        ['Repair Item', { roof: { recommendations: [{ id: 'repair', text: 'Repair roof' }] } }],
    ])('refuses a report containing a %s', async (_label, data) => {
        await db.update(schema.inspectionResults).set({ data }).where(eq(schema.inspectionResults.reportId, report));
        expect((await apply()).status).toBe(409);
        expect((await inspectionRow())?.templateId).toBe(oldTemplate);
        expect((await db.select().from(schema.inspectionResults).where(eq(schema.inspectionResults.reportId, report)).get())?.data).toEqual(data);
    });

    it('refuses saved collaborative state even when its visible projection is empty', async () => {
        const doc = new Y.Doc();
        await db.update(schema.inspectionResults).set({ ydocState: Y.encodeStateAsUpdate(doc) }).where(eq(schema.inspectionResults.reportId, report));
        expect((await apply()).status).toBe(409);
        expect((await inspectionRow())?.templateId).toBe(oldTemplate);
        doc.destroy();
    });

    it('sees live changes before the D1 projection is flushed', async () => {
        await runInDurableObject(stub, async (instance) => {
            applyItemPatch((instance as unknown as { doc: Y.Doc }).doc, 'roof', { notes: 'Still only in the live doc' });
        });
        expect((await apply()).status).toBe(409);
        expect((await inspectionRow())?.templateId).toBe(oldTemplate);
        await stub.fetch('https://do/flush', { method: 'POST', headers: headers() });
    });

    it('refuses an opened editor while its socket is connected', async () => {
        const res = await stub.fetch('https://do/ws', { headers: { ...headers(), Upgrade: 'websocket' } });
        expect(res.status).toBe(101);
        res.webSocket!.accept();
        expect((await apply()).status).toBe(409);
        res.webSocket!.close();
    });

    it('refuses a published report and a report-level narrative', async () => {
        await db.update(schema.reports).set({ inspectorNarrative: 'Narrative' }).where(eq(schema.reports.id, report));
        expect((await apply()).status).toBe(409);
        await db.update(schema.reports).set({ inspectorNarrative: null, publishedAt: new Date() }).where(eq(schema.reports.id, report));
        expect((await apply()).status).toBe(409);
        expect((await inspectionRow())?.templateId).toBe(oldTemplate);
    });

    it('protects a previous published version even after the report is returned to draft', async () => {
        await db.insert(schema.reportVersions).values({ id: crypto.randomUUID(), tenantId: tenant, inspectionId: inspection, reportId: report,
            versionNumber: 1, snapshotJson: '{}', publishedAt: new Date(), publishedBy: 'fixture-publisher' });
        expect((await apply()).status).toBe(409);
        expect((await inspectionRow())?.templateId).toBe(oldTemplate);
    });

    it('protects a loose photo before it is attached to a report item', async () => {
        await db.insert(schema.inspectionMediaPool).values({ id: crypto.randomUUID(), tenantId: tenant, inspectionId: inspection,
            r2Key: 'fixture-photo', url: '/fixture-photo', uploadedAt: new Date() });
        expect((await apply()).status).toBe(409);
        expect((await inspectionRow())?.templateId).toBe(oldTemplate);
    });

    it('refuses a foreign tenant without changing the inspection', async () => {
        const res = await stub.fetch('https://do/isn-template', { method: 'POST', headers: { ...headers(), 'x-tenant-id': 'other' } });
        expect(res.status).toBe(404);
        expect((await inspectionRow())?.templateId).toBe(oldTemplate);
    });

    it('checks again inside the batch when an HTTP narrative write arrives after the initial read', async () => {
        const batch = db.batch.bind(db);
        const spy = vi.spyOn(db, 'batch').mockImplementationOnce(async (queries) => {
            await db.update(schema.reports).set({ inspectorNarrative: 'Concurrent narrative' }).where(eq(schema.reports.id, report));
            return batch(queries);
        });
        try {
            await expect(applyIsnTemplate(db, tenant, inspection, report, false)).rejects.toThrow('changed while');
            expect((await inspectionRow())?.templateId).toBe(oldTemplate);
            expect(await db.select().from(schema.reports).where(eq(schema.reports.id, report)).get()).toMatchObject({ templateId: oldTemplate, inspectorNarrative: 'Concurrent narrative' });
        } finally { spy.mockRestore(); }
    });
});
