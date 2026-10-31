/**
 * ISN order -> OI inspection. The order fixture is the shape of a live NCHI order
 * (146, read 2026-10-24), trimmed to the fields the apply reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { decodeIsnText, foundationFromIsn, personFromIsn, isnCardFields, isnReadyCheck, orderFacts } from '../../../server/services/isn/order-payload';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
const fireAutomation = vi.fn(async () => {});
vi.mock('../../../server/services/inspection/automation-fire', () => ({ fireAutomation }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
const { applyIsnOrder } = await import('../../../server/services/isn/order-apply');
const { isnReadyChecks } = await import('../../../server/services/isn/ready-check');
const { requireTemplateSnapshot } = await import('../../../server/services/inspection/shared');

const TENANT = 't-isn';
const CFG = { domain: 'https://isn.test', companyKey: 'co', accessKey: 'a', secretKey: 's' };
const ORDER = {
    id: '69dcc50c-a0ef-5239-9599-e5ba936e76c2', oid: 146, canceled: 'no',
    datetime: '2026-10-27 10:00:00', address1: '2419 Rhyneland Street', address2: '', city: 'Gastonia',
    stateabbreviation: 'NC', zip: '28054', county: 'Gaston', latitude: 35.29, longitude: -81.15,
    squarefeet: '3121', yearbuilt: '1961', foundationtype: 'Crawl Space/Pier and Beam',
    client: 'isn-client', buyersagent: 'isn-agent', sellersagent: '',
    inspector1: 'isn-user-1', inspector2: 'isn-user-unknown', inspector3: '',
    services: [
        { uuid: 's1', name: 'Essential Residential - Full Structural and Mechanical Inspection' },
        { uuid: 's2', name: 'FlexFund' },
    ],
};
const ISN: Record<string, unknown> = {
    '/user/isn-user-1': { emailaddress: 'Lead@NCHI.test' },
    '/user/isn-user-unknown': { emailaddress: 'nobody@nchi.test' },
    '/client/isn-client': { client: { first: 'Pat', last: 'Buyer', email: 'pat@buyer.test', mobilephone: '704-555-0101' } },
    '/agent/isn-agent': { agent: { firstname: 'Ann', lastname: 'Agent', email: 'ann@realty.test' } },
};

let db: BetterSQLite3Database<typeof schema>;
const fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname.replace('/co/rest', '');
    const body = ISN[path];
    return new Response(JSON.stringify(body ? { status: 'ok', ...(body as object) } : { status: 'error', message: 'not found' }));
});

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(db);
    vi.stubGlobal('fetch', fetchMock);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'nchi', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    await db.insert(schema.users).values({ id: 'u-lead', tenantId: TENANT, email: 'lead@nchi.test', passwordHash: 'x', name: 'Lead', role: 'inspector', createdAt: new Date() } as never);
    await db.insert(schema.services).values({ id: 'svc-ess', tenantId: TENANT, name: 'Essential Residential - Full Structural and Mechanical Inspection', price: 60500, active: true, sortOrder: 0, createdAt: new Date() } as never);
    await seedRoleProfiles(asD1Db(db), TENANT, new Date());
    await db.insert(schema.isnOrders).values({ id: 'row1', tenantId: TENANT, isnOrderId: ORDER.id, payload: ORDER, fetchedAt: new Date() });
});
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockClear(); });

const D1 = {} as D1Database;
const inspectionRow = (id: string) => db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get();

describe('orderFacts', () => {
    it('reads order 146 into OI fields', () => {
        const f = orderFacts(ORDER);
        expect(f).toMatchObject({
            date: '2026-10-27T10:00:00', canceled: false, referenceNumber: '146',
            propertyAddress: '2419 Rhyneland Street, Gastonia, NC 28054',
            yearBuilt: 1961, sqft: 3121, foundationType: 'crawlspace',
            inspectorIds: ['isn-user-1', 'isn-user-unknown'], clientId: 'isn-client', sellersAgentId: null,
        });
        expect(foundationFromIsn('Slab on grade')).toBe('slab');
        expect(foundationFromIsn('')).toBeNull();
    });

    it('treats an order deleted in ISN as cancelled (ISN leaves canceled at no)', () => {
        expect(orderFacts({ ...ORDER, deleteddatetime: '2026-10-08 07:58:20', show: 'no' }).canceled).toBe(true);
        expect(orderFacts({ ...ORDER, deleteddatetime: '' }).canceled).toBe(false);
    });

    it('reads numbers ISN sends as strings, with or without thousands separators', () => {
        expect(orderFacts({ ...ORDER, latitude: '35.29', longitude: '-81.15', squarefeet: '2,400' }))
            .toMatchObject({ sqft: 2400, address: { addressLat: 35.29, addressLng: -81.15 } });
        expect(orderFacts({ ...ORDER, latitude: '' }).address.addressLat).toBeNull();
    });
});

describe('ISN entity decoding', () => {
    it('decodes numeric and named entities in one pass', () => {
        expect(decodeIsnText('Builder&#39;s &amp; Co &#x27;x&#x27; &quot;q&quot; &lt;b&gt;')).toBe('Builder\'s & Co \'x\' "q" <b>');
    });
    it('does not decode twice', () => {
        expect(decodeIsnText('&amp;#39;')).toBe('&#39;');
        expect(decodeIsnText('&amp;amp;')).toBe('&amp;');
    });
    it('leaves inherited-property names literal', () => {
        const t = '&constructor; &toString; &__proto__; &hasOwnProperty; &valueOf;';
        expect(decodeIsnText(t)).toBe(t);
    });
    it('leaves unknown or malformed entities alone', () => {
        expect(decodeIsnText('a &foo; b &#; c &#0; d & e')).toBe('a &foo; b &#; c &#0; d & e');
    });
    it('decodes service and fee names, address and people', () => {
        const f = orderFacts({
            address1: '1 O&#39;Neil St', city: 'Fort &amp; Mill',
            services: [{ name: '11th Month/Builder&#39;s Warranty' }],
            fees: [{ name: 'Rush &amp; Late', amount: '10.00' }],
        });
        expect(f.serviceNames).toEqual(["11th Month/Builder's Warranty"]);
        expect(f.fees).toEqual([{ name: 'Rush & Late', cents: 1000 }]);
        expect(f.address.addressStreet).toBe("1 O'Neil St");
        expect(f.propertyAddress).toBe("1 O'Neil St, Fort & Mill");
        expect(personFromIsn({ first: 'D&#39;Arcy', last: 'Lee' })?.name).toBe("D'Arcy Lee");
    });
    it('ready check matches an entity-encoded service name against the OI line', () => {
        const r = isnReadyCheck({ services: [{ name: 'Builder&#39;s Warranty' }] }, ["Builder's Warranty"], 0);
        expect(r.unmatchedServices).toEqual([]);
    });
});

describe('isnReadyCheck', () => {
    it('names the order services missing from the inspection, by name, ignoring case', () => {
        expect(isnReadyCheck(ORDER, ['essential residential - full structural and mechanical inspection '], 1))
            .toEqual({ unmatchedServices: ['FlexFund'], unmatchedInspectors: 1, canceledInIsn: false });
        expect(isnReadyCheck({ ...ORDER, services: [] }, [], null)).toEqual({ unmatchedServices: [], unmatchedInspectors: 0, canceledInIsn: false });
    });
    it('flags an order cancelled in ISN (the S3 conflict when OI kept the inspection)', () => {
        expect(isnReadyCheck({ ...ORDER, canceled: 'yes' }, [], null).canceledInIsn).toBe(true);
    });
});

describe('applyIsnOrder', () => {
    it('creates one scheduled inspection with the matched inspector, service, client and agent, and no booking emails', async () => {
        const id = await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: ORDER });
        expect(id).toBeTruthy();
        const insp = inspectionRow(id!)!;
        expect(insp).toMatchObject({
            status: 'scheduled', date: '2026-10-27T10:00:00', referenceNumber: '146',
            propertyAddress: '2419 Rhyneland Street, Gastonia, NC 28054', yearBuilt: 1961, sqft: 3121,
            foundationType: 'crawlspace', inspectorId: 'u-lead', teamMode: false,
        });
        const assigned = db.select().from(schema.inspectionInspectors).where(eq(schema.inspectionInspectors.inspectionId, id!)).all();
        expect(assigned.map((a) => [a.userId, a.role])).toEqual([['u-lead', 'lead']]);
        const svc = db.select().from(schema.inspectionServices).where(eq(schema.inspectionServices.inspectionId, id!)).all();
        expect(svc.map((s) => s.serviceId)).toEqual(['svc-ess']);
        const people = db.select({ email: schema.contacts.email }).from(schema.inspectionPeople)
            .innerJoin(schema.contacts, eq(schema.contacts.id, schema.inspectionPeople.contactId))
            .where(eq(schema.inspectionPeople.inspectionId, id!)).all().map((p) => p.email).sort();
        expect(people).toEqual(['ann@realty.test', 'pat@buyer.test']);
        expect(fireAutomation).not.toHaveBeenCalled();
        expect(db.select().from(schema.isnOrders).where(eq(schema.isnOrders.id, 'row1')).get())
            .toMatchObject({ inspectionId: id, unmatchedInspectors: 1 });
    });

    it('does not hold the report for payment or an agreement, whatever the company blocks by default', async () => {
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, blockUnpaid: true, blockUnsignedAgreement: true, updatedAt: new Date() } as never);
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: ORDER }))!;
        expect(inspectionRow(id)).toMatchObject({ paymentRequired: false, agreementRequired: false });
    });

    it('prices the inspection from ISN: each fee on its service by first word, the rest of totalfee on the dearest line', async () => {
        await db.insert(schema.services).values({ id: 'svc-flex', tenantId: TENANT, name: 'FlexFund', price: 0, active: false, sortOrder: 1, createdAt: new Date() } as never);
        const fees = [{ name: 'Essential Residential Inspection ', amount: 605 }, { name: 'FlexFund Service', amount: '50.00' }, { name: 'Radon Testing (in air)', amount: 0 }];
        await db.update(schema.isnOrders).set({ payload: { ...ORDER, fees, totalfee: '1,700.00' } });
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: { ...ORDER, fees, totalfee: '1,700.00' } }))!;
        const lines = () => Object.fromEntries(db.select().from(schema.inspectionServices)
            .where(eq(schema.inspectionServices.inspectionId, id)).all().map((l) => [l.serviceId, l.priceOverride]));
        expect(lines()).toEqual({ 'svc-ess': 165000, 'svc-flex': 5000 });
        expect(inspectionRow(id)?.price).toBe(170000);
        await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: { ...ORDER, fees: [{ name: 'Essential Residential Inspection', amount: 480 }], totalfee: '480.00' } });
        expect(lines()).toEqual({ 'svc-ess': 48000, 'svc-flex': 0 });
    });

    it('an order with no matched service still takes ISN\'s total as its price', async () => {
        const condo = { ...ORDER, services: [], fees: [{ name: 'Condo/Townhome', amount: 349 }], totalfee: '349.00' };
        await db.update(schema.isnOrders).set({ payload: condo });
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: condo }))!;
        expect(inspectionRow(id)?.price).toBe(34900);
    });

    it('the list ready check names the service and counts the inspector that did not match', async () => {
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: ORDER }))!;
        const checks = await isnReadyChecks(db as never, TENANT);
        expect([...checks.entries()]).toEqual([[id, { unmatchedServices: ['FlexFund'], unmatchedInspectors: 1, canceledInIsn: false }]]);
    });

    it('a second delivery updates the same inspection: ISN wins on time, and a cancel cancels an untouched report', async () => {
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: ORDER }))!;
        const moved = { ...ORDER, datetime: '2026-10-28 14:30:00', canceled: 'yes' };
        expect(await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: moved })).toBe(id);
        expect(inspectionRow(id)).toMatchObject({ date: '2026-10-28T14:30:00', status: 'cancelled' });
        expect(db.select().from(schema.inspections).all()).toHaveLength(1);
    });

    it('does not cancel a report that has writing in it', async () => {
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: ORDER }))!;
        await db.update(schema.inspectionResults).set({ data: { item1: { rating: 'ok' } } })
            .where(and(eq(schema.inspectionResults.inspectionId, id), eq(schema.inspectionResults.tenantId, TENANT)));
        await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: { ...ORDER, canceled: 'yes' } });
        expect(inspectionRow(id)?.status).toBe('scheduled');
    });

    it('creates nothing for an order already cancelled, or while another delivery holds the claim', async () => {
        expect(await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: { ...ORDER, canceled: 'yes' } })).toBeNull();
        await db.update(schema.isnOrders).set({ inspectionId: 'pending:x' });
        expect(await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: ORDER })).toBeNull();
        expect(await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: 'pending:x', payload: ORDER })).toBeNull();
        expect(db.select().from(schema.inspections).all()).toHaveLength(0);
    });

    it('a later delivery keeps OI values ISN leaves blank, and the team when an ISN inspector has no OI user', async () => {
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: ORDER }))!;
        await db.update(schema.inspections).set({ inspectorId: 'u-lead' }).where(eq(schema.inspections.id, id));
        await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: { ...ORDER, squarefeet: '', county: '', inspector1: 'isn-user-unknown', inspector2: '' } });
        expect(inspectionRow(id)).toMatchObject({ sqft: 3121, addressCounty: 'Gaston', inspectorId: 'u-lead' });
    });

    describe('an order first seen as an online-booking draft', () => {
        const DRAFT = { ...ORDER, client: '', buyersagent: '', services: [] };
        const seedTemplate = async () => {
            await db.insert(schema.templates).values({ id: 'tpl-ess', tenantId: TENANT, name: 'Essential', slug: 'ess', version: 4, schema: { schemaVersion: 2, sections: [{ id: 's1', title: 'Roof', items: [] }] }, createdAt: new Date() } as never);
            await db.update(schema.services).set({ templateId: 'tpl-ess' }).where(eq(schema.services.id, 'svc-ess'));
            await db.update(schema.isnOrders).set({ payload: DRAFT });
        };
        const peopleEmails = (id: string) => db.select({ email: schema.contacts.email }).from(schema.inspectionPeople)
            .innerJoin(schema.contacts, eq(schema.contacts.id, schema.inspectionPeople.contactId))
            .where(eq(schema.inspectionPeople.inspectionId, id)).all().map((p) => p.email).sort();
        const serviceIds = (id: string) => db.select().from(schema.inspectionServices)
            .where(eq(schema.inspectionServices.inspectionId, id)).all().map((s) => s.serviceId);

        it('a later delivery fills in the client, agent, services and template, and prices the new line', async () => {
            await seedTemplate();
            const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: DRAFT }))!;
            expect(peopleEmails(id)).toEqual([]);
            expect(serviceIds(id)).toEqual([]);

            await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: { ...ORDER, totalfee: '425.00' } });

            expect(peopleEmails(id)).toEqual(['ann@realty.test', 'pat@buyer.test']);
            expect(serviceIds(id)).toEqual(['svc-ess']);
            const row = inspectionRow(id)!;
            expect(row).toMatchObject({ templateId: 'tpl-ess', templateSnapshotVersion: 4 });
            expect(requireTemplateSnapshot(row, TENANT).sections.map((s) => s.title)).toEqual(['Roof']);
            expect(db.select().from(schema.inspectionServices).where(eq(schema.inspectionServices.inspectionId, id)).get()?.priceOverride).toBe(42500);
        });

        it('a template picked in OI meanwhile stays, and the filled lines do not double on the next delivery', async () => {
            await seedTemplate();
            const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: DRAFT }))!;
            await db.insert(schema.templates).values({ id: 'tpl-picked', tenantId: TENANT, name: 'Picked', slug: 'picked', schema: { sections: [] }, createdAt: new Date() } as never);
            await db.update(schema.inspections).set({ templateId: 'tpl-picked' }).where(eq(schema.inspections.id, id));
            await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: ORDER });
            await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: ORDER });
            expect(inspectionRow(id)?.templateId).toBe('tpl-picked');
            expect(serviceIds(id)).toEqual(['svc-ess']);
            expect(peopleEmails(id)).toHaveLength(2);
        });
    });

    it('a later delivery never replaces the people or services an inspection already has', async () => {
        await db.insert(schema.services).values({ id: 'svc-flex', tenantId: TENANT, name: 'FlexFund', price: 0, active: true, sortOrder: 1, createdAt: new Date() } as never);
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: { ...ORDER, services: [ORDER.services[0]] } }))!;
        // 'isn-client-unknown' would throw if it were looked up.
        await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: { ...ORDER, client: 'isn-client-unknown' } });
        expect(db.select().from(schema.inspectionServices).where(eq(schema.inspectionServices.inspectionId, id)).all().map((s) => s.serviceId)).toEqual(['svc-ess']);
    });

    it('an order reinstated in ISN is scheduled again', async () => {
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: ORDER }))!;
        await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: { ...ORDER, canceled: 'yes' } });
        expect(inspectionRow(id)?.status).toBe('cancelled');
        await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: id, payload: ORDER });
        expect(inspectionRow(id)?.status).toBe('scheduled');
    });

    it('the creating delivery applies a payload stored while it held the claim', async () => {
        await db.update(schema.isnOrders).set({ payload: { ...ORDER, datetime: '2026-10-29 09:00:00', canceled: 'yes' } });
        const id = (await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: ORDER }))!;
        expect(inspectionRow(id)).toMatchObject({ date: '2026-10-29T09:00:00', status: 'cancelled' });
    });

    it('a failure after the inspection exists keeps the link, and the retry finishes the same inspection', async () => {
        const broken = { ...ORDER, inspector1: 'isn-user-missing' };
        await db.update(schema.isnOrders).set({ payload: broken });
        await expect(applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: broken })).rejects.toThrow();
        const linked = db.select().from(schema.isnOrders).get()?.inspectionId;
        expect(linked).toBeTruthy();
        expect(await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: linked!, payload: ORDER })).toBe(linked);
        expect(db.select().from(schema.inspections).all()).toHaveLength(1);
        expect(inspectionRow(linked!)).toMatchObject({ status: 'scheduled', inspectorId: 'u-lead' });
    });

    it('a failed ISN lookup creates nothing and releases nothing it did not claim', async () => {
        const id = await applyIsnOrder(D1, TENANT, CFG, { id: 'row1', inspectionId: null, payload: { ...ORDER, client: 'missing' } })
            .catch((e: Error) => e);
        expect(id).toBeInstanceOf(Error);
        expect(db.select().from(schema.inspections).all()).toHaveLength(0);
        expect(db.select().from(schema.isnOrders).get()?.inspectionId).toBeNull();
    });
});

describe('isnCardFields', () => {
    it('reads the card facts, trimming the \r ISN leaves on yes/no values', () => {
        expect(isnCardFields({ ...ORDER, gatecode: '1234#', propertyoccupied: 'yes\r', utilitieson: 'no', paid: 'no', signature: 'yes', reportnumber: '' }))
            .toMatchObject({ orderNumber: '146', accessCode: '1234#', occupied: true, utilitiesOn: false, paid: false, signed: true, reportNumber: null, canceled: false });
    });

    it('links directions to ISN\'s https map, else to a maps search on the coordinates or address', () => {
        expect(isnCardFields({ ...ORDER, mapurl: 'https://maps.isn.test/146' }).directionsUrl).toBe('https://maps.isn.test/146');
        expect(isnCardFields({ ...ORDER, mapurl: 'javascript:alert(1)' }).directionsUrl).toContain('destination=35.29%2C-81.15');
        expect(isnCardFields({ ...ORDER, latitude: '', longitude: '' }).directionsUrl).toContain(encodeURIComponent('2419 Rhyneland Street'));
        expect(isnCardFields({}).directionsUrl).toBeNull();
    });
});
