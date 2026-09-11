/**
 * The readiness gate has to live on the SERVER.
 *
 * `computePublishReadiness` decides whether a report may ship — an unresolved
 * `{{location}}` token renders as a literal gap in the document a client reads,
 * which is why the gate treats it as blocking rather than advisory. It was
 * enforced in exactly one place: `inspection-edit.tsx`'s pre-flight fetch, which
 * falls through to the publish modal on a network error. Two other first-party
 * callers never asked at all — the inspector hub's publish action
 * (`app/routes/inspector-portal.tsx`) and the MCP/API surface — so the blocked
 * report shipped through ordinary UI use, not a crafted request.
 *
 * These assertions drive the REAL service, because the fault was never in the
 * readiness computation (which has its own spec) but in nobody calling it.
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

describe('publishInspection refuses a report the readiness gate blocks', () => {
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

    it('throws a 400 whose message names the blocked defect', async () => {
        await seed(structure('Replace shingles at {{location}}.'));
        // Proof the fixture is the blocking shape, not a broken fixture.
        const readiness = await svc.computePublishReadiness(INSPECTION_ID, TENANT);
        expect(readiness.ready).toBe(false);

        await expect(svc.publishInspection(INSPECTION_ID, TENANT, PUBLISH_OPTIONS))
            .rejects.toMatchObject({ status: 400 });
        // The editor's action.server.ts surfaces `error.message` verbatim in the
        // publish modal, so the reason has to be IN the message — a bare
        // "couldn't publish" is what sent the inspector back to guessing.
        await expect(svc.publishInspection(INSPECTION_ID, TENANT, PUBLISH_OPTIONS))
            .rejects.toThrow(/Roof Covering|Missing shingles|1 defect/i);
    });

    it('leaves the report unpublished — the refusal is before the status write', async () => {
        await seed(structure('Replace shingles at {{location}}.'));
        const before = await reportStatus();
        await expect(svc.publishInspection(INSPECTION_ID, TENANT, PUBLISH_OPTIONS)).rejects.toThrow();
        expect(await reportStatus()).toBe(before);
    });

    it('carries the blockers as error details for a richer surface than one line', async () => {
        await seed(structure('Replace shingles at {{location}}.'));
        const err = await svc.publishInspection(INSPECTION_ID, TENANT, PUBLISH_OPTIONS)
            .then(() => null, (e: unknown) => e as { details?: { blockingDefects?: unknown[] } });
        expect(err?.details?.blockingDefects).toHaveLength(1);
    });

    it('publishes when nothing blocks — the gate is not a new refusal of good work', async () => {
        // Same defect, location supplied, so the token resolves.
        await seed(structure('Replace shingles at {{location}}.', 'north slope'));
        expect((await svc.computePublishReadiness(INSPECTION_ID, TENANT)).ready).toBe(true);
        const out = await svc.publishInspection(INSPECTION_ID, TENANT, PUBLISH_OPTIONS);
        expect(out.reportStatus).toBe('published');
        expect(await reportStatus()).toBe('published');
    });
});
