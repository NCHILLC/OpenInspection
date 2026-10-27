/**
 * Temperature and Weather are required to publish a NEW report, and only a new
 * one: an inspection already published (or published once and since amended)
 * must never become unpublishable because these fields did not exist when it
 * went out. This drives the REAL service, so the gate is checked where the
 * editor and the hub read it. The server still does not refuse a publish; see
 * publish-readiness-gate.spec.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { InspectionService } from '../../../server/services/inspection.service';

const TENANT = 'tenant-publish-gate';
const TEMPLATE_ID = 'tpl-gate';
const INSPECTION_ID = 'insp-gate';

function structure(comment: string, location?: string) {
    return {
        schemaVersion: 2,
        sections: [{
            id: 'sec1', title: 'Roof', items: [{
                id: 'item1', label: 'Roof Covering', type: 'rich',
                ratingOptions: ['Inspected', 'Repair'],
                tabs: {
                    information: [], limitations: [],
                    defects: [{
                        id: 'def1', title: 'Missing shingles', comment,
                        default: true, ...(location ? { location } : {}),
                    }],
                },
            }],
        }],
    };
}

describe('computePublishReadiness - facts gate (service)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let svc: InspectionService;

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db;
        sqlite = fx.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'publish-gate', createdAt: new Date(),
        } as never);
        await db.insert(schema.templates).values({
            id: TEMPLATE_ID, tenantId: TENANT, name: 'Standard', version: 1,
            schema: JSON.stringify({ schemaVersion: 2, sections: [] }), createdAt: new Date(),
        } as never);
        svc = new InspectionService({} as never);
    });

    afterEach(() => { sqlite.close(); });

    async function seed(templateSnapshot: unknown, overrides: Partial<typeof schema.inspections.$inferInsert> = {}) {
        await db.insert(schema.inspections).values({
            id: INSPECTION_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            templateId: TEMPLATE_ID, templateSnapshot: JSON.stringify(templateSnapshot),
            date: '2026-08-11', status: 'in_progress', reportStatus: 'in_progress', createdAt: new Date(),
            ...overrides,
        } as never);
    }

    const readyStructure = structure('Replace shingles at {{location}}.', 'north slope');

    it('(a) a never-published in_progress inspection with temperature_f and weather NULL -> ready false and missingFacts [\'temperature\',\'weather\']', async () => {
        await seed(readyStructure, { temperatureF: null, weather: null, reportStatus: 'in_progress' });
        const readiness = await svc.computePublishReadiness(INSPECTION_ID, TENANT);
        expect(readiness.ready).toBe(false);
        expect(readiness.missingFacts).toEqual(['temperature', 'weather']);
    });

    it('(b) same inspection with both set -> ready true', async () => {
        await seed(readyStructure, { temperatureF: 72, weather: 'clear', reportStatus: 'in_progress' });
        const readiness = await svc.computePublishReadiness(INSPECTION_ID, TENANT);
        expect(readiness.ready).toBe(true);
        expect(readiness.missingFacts).toEqual([]);
    });

    it('(c) an inspection whose reportStatus is \'published\' with both NULL -> missingFacts [] and ready true (retroactivity guard)', async () => {
        await seed(readyStructure, { temperatureF: null, weather: null, reportStatus: 'published' });
        const readiness = await svc.computePublishReadiness(INSPECTION_ID, TENANT);
        expect(readiness.ready).toBe(true);
        expect(readiness.missingFacts).toEqual([]);
    });

    it('(d) an in_progress inspection with both NULL but a prior row in report_versions for it (a republish/amendment) -> missingFacts []', async () => {
        await seed(readyStructure, { temperatureF: null, weather: null, reportStatus: 'in_progress' });
        await db.insert(schema.reportVersions).values({
            id: 'rv1', tenantId: TENANT, inspectionId: INSPECTION_ID, versionNumber: 1, snapshotJson: '{}', publishedAt: new Date(), publishedBy: 'tester', createdAt: new Date(),
        } as never);
        const readiness = await svc.computePublishReadiness(INSPECTION_ID, TENANT);
        expect(readiness.missingFacts).toEqual([]);
    });
});
