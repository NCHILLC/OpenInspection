/**
 * Turns the stored copy of an ISN order (`isn_orders.payload`) into an OI
 * inspection, or brings the existing one up to date. ISN is the CRM: it wins on
 * schedule and order facts (decision S3), so every pull rewrites the date,
 * address, property facts and who is assigned.
 *
 * Creation goes through `InspectionCoreService.createInspection`, the primitive
 * the wizard also uses, with the booking-confirmation automations off: ISN has
 * already confirmed the booking to the client. The new inspection is linked to
 * its order straight away and then goes through the same update as every later
 * delivery, so a failure past that point (the webhook answers 500, ISN retries)
 * is finished by the retry instead of creating a second inspection.
 *
 * The client, agents, services and template are OI's once set: a later delivery
 * only fills the ones the inspection has none of (`fillBlanksFromOrder`).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { contactRoleProfiles, inspectionPeople, inspections, inspectionResults, inspectionServices, isnOrders, services, users } from '../../lib/db/schema';
import { createScopedDb, type DrizzleDB } from '../../lib/db/scoped';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { writeInspectionServiceSnapshots } from '../../lib/inspection/service-snapshot';
import { templateSnapshotValues } from '../../lib/inspection/template-snapshot';
import { logger } from '../../lib/logger';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { ContactService } from '../contact.service';
import { InspectionCoreService } from '../inspection/inspection-core.service';
import { PeopleService } from '../people.service';
import { isnCall, type IsnConfig } from './api-base';
import { orderFacts, personFromIsn, type IsnOrderFacts } from './order-payload';

type Rec = Record<string, unknown>;
type Db = DrizzleD1Database;

/** ISN user id -> OI user id, by email. Unmatched inspectors are logged and left off. */
async function matchInspectors(db: Db, cfg: IsnConfig, tenantId: string, isnUserIds: string[]): Promise<string[]> {
    // Concurrent, in ISN's order: the first matched inspector becomes the lead.
    const ids = await Promise.all(isnUserIds.map(async (isnId) => {
        const body = await isnCall(cfg, 'GET', `/user/${encodeURIComponent(isnId)}`);
        // The spec shows the fields flat on the body; some ISN endpoints wrap them. Accept both.
        const email = String(((body.user as Rec | undefined) ?? body).emailaddress ?? '').trim().toLowerCase();
        const row = email
            ? await db.select({ id: users.id }).from(users)
                .where(and(eq(users.tenantId, tenantId), sql`lower(${users.email}) = ${email}`)).get()
            : undefined;
        if (!row) logger.warn('ISN order: inspector has no OI user with that email', { isnUserId: isnId, hasEmail: !!email });
        return row?.id;
    }));
    return ids.filter((id): id is string => !!id);
}

async function fetchPerson(cfg: IsnConfig, kind: 'client' | 'agent', id: string | null) {
    if (!id) return null;
    return personFromIsn((await isnCall(cfg, 'GET', `/${kind}/${encodeURIComponent(id)}`))[kind] as Rec | undefined);
}

/** The order's services OI has, by name. An ISN service OI lacks is logged and left off. */
async function matchServices(db: Db, tenantId: string, rowId: string, f: IsnOrderFacts) {
    const catalog = await db.select({ id: services.id, name: services.name, templateId: services.templateId })
        .from(services).where(eq(services.tenantId, tenantId));
    const byName = new Map(catalog.map((s) => [s.name.trim().toLowerCase(), s]));
    const matched = f.serviceNames.map((n) => byName.get(n.toLowerCase())).filter((s): s is NonNullable<typeof s> => !!s);
    if (matched.length < f.serviceNames.length) {
        logger.warn('ISN order: services with no OI service of the same name', { isnOrderRowId: rowId, unmatched: f.serviceNames.length - matched.length });
    }
    return matched;
}

export async function applyIsnOrder(
    d1: D1Database, tenantId: string, cfg: IsnConfig,
    row: { id: string; inspectionId: string | null; payload: Rec },
): Promise<string | null> {
    const db = drizzle(d1);
    // Another delivery is creating this order's inspection right now; it applies
    // the newest stored payload once it is done (below), this one included.
    if (row.inspectionId?.startsWith('pending:')) return null;
    if (row.inspectionId) return updateFromOrder(d1, db, cfg, tenantId, row.id, row.inspectionId, row.payload);

    const created = await createFromOrder(d1, db, cfg, tenantId, row);
    if (!created) return null;
    const latest = await db.select({ payload: isnOrders.payload }).from(isnOrders)
        .where(and(eq(isnOrders.id, row.id), eq(isnOrders.tenantId, tenantId))).get();
    return updateFromOrder(d1, db, cfg, tenantId, row.id, created, (latest?.payload as Rec | undefined) ?? row.payload);
}

/** Creates the bare inspection and links it to the order; facts, team and status come from `updateFromOrder`. */
async function createFromOrder(
    d1: D1Database, db: Db, cfg: IsnConfig, tenantId: string,
    row: { id: string; payload: Rec },
): Promise<string | null> {
    const f = orderFacts(row.payload);
    // Never create an inspection for an order that was cancelled before OI saw it.
    if (f.canceled || !f.propertyAddress) return null;

    const [client, buyersAgent, sellersAgent] = await Promise.all([
        fetchPerson(cfg, 'client', f.clientId),
        fetchPerson(cfg, 'agent', f.buyersAgentId),
        fetchPerson(cfg, 'agent', f.sellersAgentId),
    ]);

    // Claim the row so two deliveries for one new order (ORDER_CREATED and
    // ORDER_SCHEDULED arrive together) cannot both create an inspection.
    // A Worker killed between claim and create leaves the row claimed; the
    // reconcile cron frees claims older than STALE_CLAIM_MS (order-reconcile.ts).
    const claim = `pending:${crypto.randomUUID()}`;
    const claimed = await db.update(isnOrders).set({ inspectionId: claim })
        .where(and(eq(isnOrders.id, row.id), eq(isnOrders.tenantId, tenantId), isNull(isnOrders.inspectionId)))
        .returning({ id: isnOrders.id });
    if (claimed.length === 0) return null;

    let createdId: string;
    try {
        const contactsSvc = new ContactService(d1);
        const agentId = async (p: typeof buyersAgent) => (p ? (await contactsSvc.upsertClientContact(tenantId, { ...p, type: 'agent' })).id : null);
        const matched = await matchServices(db, tenantId, row.id, f);

        const core = new InspectionCoreService(d1, undefined, createScopedDb(db as unknown as DrizzleDB, tenantId));
        createdId = (await core.createInspection(tenantId, {
            propertyAddress: f.propertyAddress,
            ...f.address,
            date: f.date ?? undefined,
            templateId: matched.find((s) => s.templateId)?.templateId ?? null,
            serviceIds: matched.map((s) => s.id),
            clientName: client?.name ?? 'Private Client',
            clientEmail: client?.email ?? null,
            clientPhone: client?.phone ?? null,
            referredByAgentId: await agentId(buyersAgent),
            sellingAgentId: await agentId(sellersAgent),
            // ISN takes the payment and the agreement, and OI offers no way to do
            // either while it is the CRM, so the company's block defaults would
            // hold this report forever.
            paymentRequired: false,
            agreementRequired: false,
        } as unknown as Parameters<InspectionCoreService['createInspection']>[1], { automations: false })).id;
    } catch (e) {
        // Nothing was created, so the next delivery may try again.
        await db.update(isnOrders).set({ inspectionId: null })
            .where(and(eq(isnOrders.id, row.id), eq(isnOrders.tenantId, tenantId), eq(isnOrders.inspectionId, claim)));
        throw e;
    }
    await db.update(isnOrders).set({ inspectionId: createdId })
        .where(and(eq(isnOrders.id, row.id), eq(isnOrders.tenantId, tenantId)));
    return createdId;
}

/**
 * An online booking reaches OI as soon as ISN saves its draft, before the client
 * has picked services or given a name, so the create can find none of them.
 * Every later delivery fills what the inspection still has none of. Nothing here
 * replaces a value: OI staff may have chosen differently since.
 */
async function fillBlanksFromOrder(d1: D1Database, db: Db, cfg: IsnConfig, tenantId: string, rowId: string, inspectionId: string, f: IsnOrderFacts): Promise<void> {
    const onInspection = and(eq(inspectionPeople.tenantId, tenantId), eq(inspectionPeople.inspectionId, inspectionId));
    const seated = new Set((await db.select({ key: contactRoleProfiles.key }).from(inspectionPeople)
        .innerJoin(contactRoleProfiles, eq(contactRoleProfiles.id, inspectionPeople.roleProfileId))
        .where(onInspection).all()).map((p) => p.key));
    const seats = ([
        ['client', 'client', f.clientId], ['buyer_agent', 'agent', f.buyersAgentId], ['listing_agent', 'agent', f.sellersAgentId],
    ] as const).filter(([key, , isnId]) => isnId && !seated.has(key));
    if (seats.length > 0) {
        const roles = new Map((await db.select({ id: contactRoleProfiles.id, key: contactRoleProfiles.key }).from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.active, true))).all()).map((r) => [r.key, r.id]));
        const contactsSvc = new ContactService(d1);
        const people = new PeopleService({ DB: d1 });
        for (const [key, kind, isnId] of seats) {
            const person = await fetchPerson(cfg, kind, isnId);
            const role = roles.get(key);
            if (person && role) await people.addPerson(tenantId, inspectionId, (await contactsSvc.upsertClientContact(tenantId, { ...person, type: kind })).id, role);
        }
    }

    // A line kept but switched off counts: someone took that service off on purpose.
    const hasLine = await db.select({ id: inspectionServices.id }).from(inspectionServices)
        .where(and(eq(inspectionServices.tenantId, tenantId), eq(inspectionServices.inspectionId, inspectionId))).get();
    if (hasLine || f.serviceNames.length === 0) return;
    const matched = await matchServices(db, tenantId, rowId, f);
    // Template first: lines existing is what stops the next delivery from retrying this.
    const templateId = matched.find((s) => s.templateId)?.templateId;
    const snapshot = templateId ? await templateSnapshotValues(db, tenantId, templateId) : null;
    if (snapshot) {
        await db.update(inspections).set({ templateId, ...snapshot })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId), isNull(inspections.templateId)));
    }
    await writeInspectionServiceSnapshots(db, tenantId, inspectionId, { serviceIds: matched.map((s) => s.id) });
}

async function updateFromOrder(d1: D1Database, db: Db, cfg: IsnConfig, tenantId: string, rowId: string, inspectionId: string, payload: Rec): Promise<string> {
    const f = orderFacts(payload);
    const inspectorIds = await matchInspectors(db, cfg, tenantId, f.inspectorIds);
    await db.update(isnOrders).set({ unmatchedInspectors: f.inspectorIds.length - inspectorIds.length })
        .where(and(eq(isnOrders.id, rowId), eq(isnOrders.tenantId, tenantId)));
    const where = and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId));

    // A blank ISN field means ISN does not know, not that OI's value is wrong.
    const facts: Partial<typeof inspections.$inferInsert> = Object.fromEntries(Object.entries({
        date: f.date, propertyAddress: f.propertyAddress, ...f.address,
        yearBuilt: f.yearBuilt, sqft: f.sqft, foundationType: f.foundationType, referenceNumber: f.referenceNumber,
        price: f.totalCents,
    }).filter(([, v]) => v !== null));
    // Once someone is assigned, the team follows ISN only when every ISN inspector
    // has an OI user: one mismatched email must not unassign whoever OI staff put on the job.
    const current = await db.select({ inspectorId: inspections.inspectorId }).from(inspections).where(where).get();
    const team = !current?.inspectorId || inspectorIds.length === f.inspectorIds.length
        ? { inspectorId: inspectorIds[0] ?? null, leadInspectorId: inspectorIds[0] ?? null, helperInspectorIds: inspectorIds.slice(1) }
        : null;
    if (team) Object.assign(facts, { inspectorId: team.inspectorId, teamMode: inspectorIds.length > 1 });

    if (Object.keys(facts).length > 0) await db.update(inspections).set(facts).where(where);
    if (team) await syncInspectionAssignments(db, tenantId, inspectionId, team);
    await fillBlanksFromOrder(d1, db, cfg, tenantId, rowId, inspectionId, f);
    if (f.totalCents !== null) await priceLinesFromIsn(db, tenantId, inspectionId, f.fees, f.totalCents);
    if (f.canceled) await cancelIfUntouched(db, tenantId, inspectionId);
    // New (still Requested) or reinstated in ISN: the order is on the calendar.
    else await db.update(inspections).set({ status: INSPECTION_STATUS.SCHEDULED })
        .where(and(where, inArray(inspections.status, [INSPECTION_STATUS.REQUESTED, INSPECTION_STATUS.CANCELLED])));
    return inspectionId;
}

/**
 * ISN bills the order, so its fees are the price. Each fee goes on the line whose
 * service shares its first word (fee "Termite Inspection (WDIR letter)", service
 * "Termite (WDIR letter)"); what is left of `totalfee` (unmatched fees, discounts,
 * tax) goes on the dearest line, so the lines always sum to ISN's total.
 */
// ponytail: first-word match, a fee <-> service map in ISN settings if two services ever share a first word.
async function priceLinesFromIsn(db: Db, tenantId: string, inspectionId: string, fees: { name: string; cents: number }[], totalCents: number): Promise<void> {
    const lines = await db.select({ id: inspectionServices.id, name: inspectionServices.nameSnapshot }).from(inspectionServices)
        .where(and(eq(inspectionServices.tenantId, tenantId), eq(inspectionServices.inspectionId, inspectionId), eq(inspectionServices.active, true)));
    if (lines.length === 0) return;
    const word = (s: string) => s.trim().split(/\s+/)[0]!.toLowerCase();
    const price = new Map(lines.map((l) => [l.id, 0]));
    for (const fee of fees) {
        const line = lines.find((l) => word(l.name) === word(fee.name));
        if (line) price.set(line.id, price.get(line.id)! + fee.cents);
    }
    const dearest = [...price.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    price.set(dearest, price.get(dearest)! + totalCents - [...price.values()].reduce((a, b) => a + b, 0));
    for (const [id, cents] of price) {
        await db.update(inspectionServices).set({ priceOverride: cents })
            .where(and(eq(inspectionServices.id, id), eq(inspectionServices.tenantId, tenantId)));
    }
}

/** S3: an ISN cancel never cancels a report that has writing in it; that one is only logged. */
async function cancelIfUntouched(db: Db, tenantId: string, inspectionId: string): Promise<void> {
    const results = await db.select({ data: inspectionResults.data }).from(inspectionResults)
        .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId))).all();
    // An item the inspector touched and then cleared projects as `{}`: not writing.
    const written = results.some((r) => Object.values((r.data ?? {}) as Rec)
        .some((entry) => entry && typeof entry === 'object' && Object.keys(entry).length > 0));
    if (written) {
        logger.warn('ISN order cancelled but the report has writing; left as is', { inspectionId });
        return;
    }
    await db.update(inspections).set({ status: INSPECTION_STATUS.CANCELLED })
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
}
