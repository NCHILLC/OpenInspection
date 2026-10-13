/**
 * DELIV-01 — the starter agreement used to be sendable and signable with every
 * merge field still in brackets and the admin-only "review before sending"
 * notice inside the permanent signed snapshot. Fields are now filled at send
 * time and a body that still carries placeholders or the notice is refused.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AgreementService } from '../../../server/services/agreement.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { AGREEMENT_TEMPLATE } from '../../../server/services/starter-content/fixtures/agreement-template';
import { fillAgreementTokens, blockingAgreementIssues } from '../../../server/lib/agreement-tokens';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENT = 'contact-client-1';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const AGR_ID = '00000000-0000-0000-0000-000000000020';
const USER = 'user-inspector-1';

const withoutNotice = AGREEMENT_TEMPLATE.content.replace(/^<p><strong>⚠️.*?<\/p>/, '');

describe('fillAgreementTokens / blockingAgreementIssues', () => {
    it('fills the starter fields and leaves nothing blocking', () => {
        const out = fillAgreementTokens(withoutNotice.replace(/<h3>4\..*?<\/p>/, ''), {
            inspector: 'Quinn <Assurance>', client: 'Pat Rivera', address: '742 Ivy Lane', date: '2026-10-20T09:00:00Z', amountCents: 40000,
        });
        expect(out).toContain('Quinn &lt;Assurance&gt; ("Inspector")');
        expect(out).toContain('Pat Rivera ("Client")');
        expect(out).toContain('October 20, 2026');
        expect(out).toContain('Inspection fee: $400.00.');
        expect(blockingAgreementIssues(out)).toEqual([]);
    });

    it('a missing value stays bracketed and blocks', () => {
        const out = fillAgreementTokens('<p>[CUSTOMER_NAME] pays $[AMOUNT]</p>', { client: 'Pat', amountCents: 0 });
        expect(out).toBe('<p>Pat pays $[AMOUNT]</p>');
        expect(blockingAgreementIssues(out)[0]).toContain('[AMOUNT]');
    });
});

describe('AgreementService.findOrCreate — starter agreement merge fields (DELIV-01)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: AgreementService;

    const seedAgreement = (content: string) =>
        db.update(schema.agreements).set({ content }).where(eq(schema.agreements.id, AGR_ID));

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: USER, tenantId: TENANT, email: 'q@example.com', passwordHash: 'x', name: 'Quinn Assurance', role: 'owner', createdAt: new Date(),
        } as typeof schema.users.$inferInsert);
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT, name: AGREEMENT_TEMPLATE.name, content: AGREEMENT_TEMPLATE.content, version: 1, createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: TENANT, type: 'client', name: 'Pat Rivera', email: 'pat@example.com', phone: '+15551234567', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, inspectorId: USER, propertyAddress: '742 Ivy Lane, Charlotte, NC', date: '2026-10-20',
            status: 'requested', paymentStatus: 'unpaid', price: 40000, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        });
        await new PeopleService({ DB: {} as D1Database }).addPerson(TENANT, INSP_ID, CLIENT, `crp_${TENANT}_client`);
        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
    });

    it('the unedited starter template is refused and creates no envelope', async () => {
        await expect(svc.findOrCreate(TENANT, INSP_ID)).rejects.toMatchObject({ status: 422 });
        expect(await db.select().from(schema.agreementRequests).all()).toHaveLength(0);
    });

    it('once the notice and liability placeholder are edited out, the snapshot carries the real values', async () => {
        await seedAgreement(withoutNotice.replace(/<h3>4\..*?<\/p>/, ''));
        const r = await svc.findOrCreate(TENANT, INSP_ID);
        const env = await db.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, r.requestId)).get();
        expect(env?.contentSnapshot).toContain('Quinn Assurance ("Inspector")');
        expect(env?.contentSnapshot).toContain('Pat Rivera ("Client")');
        expect(env?.contentSnapshot).toContain('742 Ivy Lane, Charlotte, NC on October 20, 2026');
        expect(env?.contentSnapshot).toContain('$400.00');
        expect(env?.contentSnapshot).not.toMatch(/\[[A-Z_]{3,}/);
    });
});
