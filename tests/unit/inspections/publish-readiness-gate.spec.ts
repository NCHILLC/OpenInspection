/**
 * Readiness WARNS. It does not refuse a publish.
 *
 * `computePublishReadiness` reports defects that still need attention — an
 * unresolved `{{location}}` token among them — and the editor and the inspector
 * hub surface that count before the inspector publishes. The server does not
 * turn it into a refusal. That is a product decision, not an omission:
 * upstream d685a459 surveyed five established products on 2026-09-07 and found
 * four never block publishing on completeness, and the one that can — Spectora
 * — ships it off by default. The fork adopted the same rule on 2026-09-13.
 *
 * This file used to assert the opposite. It now exists so that a future "just
 * refuse it on the server" goes red here instead of quietly reversing that
 * decision. It drives the REAL service with a report the readiness check flags.
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

const PUBLISH_OPTIONS = {
    theme: 'modern',
    notifyClient: false,
    notifyAgent: false,
    requireSignature: false,
    requirePayment: false,
};

/** One rich item carrying one defect that is included by default. `comment`
 *  references {{location}}, and `location` is left unset — the blocking shape. */
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

describe('publishInspection publishes a report the readiness check flags', () => {
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
        // The row exists only to satisfy inspections.template_id's FK; the gate
        // reads the per-inspection snapshot, never this (#307).
        await db.insert(schema.templates).values({
            id: TEMPLATE_ID, tenantId: TENANT, name: 'Standard', version: 1,
            schema: JSON.stringify({ schemaVersion: 2, sections: [] }), createdAt: new Date(),
        } as never);
        svc = new InspectionService({} as never);
    });

    afterEach(() => { sqlite.close(); });

    async function seed(templateSnapshot: unknown) {
        await db.insert(schema.inspections).values({
            id: INSPECTION_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            templateId: TEMPLATE_ID, templateSnapshot: JSON.stringify(templateSnapshot),
            date: '2026-08-11', status: 'completed', createdAt: new Date(),
        } as never);
    }

    async function reportStatus() {
        const row = await db.select({ reportStatus: schema.inspections.reportStatus })
            .from(schema.inspections).get();
        return row?.reportStatus ?? null;
    }

    it('publishes an unready report — the count is a warning, never a refusal', async () => {
        // A defect whose comment names {{location}} with no location supplied:
        // exactly the report the readiness check flags as needing attention.
        await seed(structure('Replace shingles at {{location}}.'));
        const readiness = await svc.computePublishReadiness(INSPECTION_ID, TENANT);
        expect(readiness.ready).toBe(false);
        expect(readiness.blockingDefects.length).toBeGreaterThan(0);

        const out = await svc.publishInspection(INSPECTION_ID, TENANT, PUBLISH_OPTIONS);
        expect(out.reportStatus).toBe('published');
        expect(await reportStatus()).toBe('published');
    });

    it('publishes a ready report too — the positive control', async () => {
        // Same defect, location supplied, so the token resolves.
        await seed(structure('Replace shingles at {{location}}.', 'north slope'));
        expect((await svc.computePublishReadiness(INSPECTION_ID, TENANT)).ready).toBe(true);
        const out = await svc.publishInspection(INSPECTION_ID, TENANT, PUBLISH_OPTIONS);
        expect(out.reportStatus).toBe('published');
        expect(await reportStatus()).toBe('published');
    });
});
