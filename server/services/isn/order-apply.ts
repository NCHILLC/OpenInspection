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
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, inspectionResults, isnOrders, services, users } from '../../lib/db/schema';
import { createScopedDb, type DrizzleDB } from '../../lib/db/scoped';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { logger } from '../../lib/logger';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { ContactService } from '../contact.service';
import { InspectionCoreService } from '../inspection/inspection-core.service';
import { isnCall, type IsnConfig } from './api-base';
import { orderFacts, personFromIsn } from './order-payload';

type Rec = Record<string, unknown>;
type Db = DrizzleD1Database;

/** ISN user id -> OI user id, by email. Unmatched inspectors are logged and left off. */
async function matchInspectors(db: Db, cfg: IsnConfig, tenantId: string, isnUserIds: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const isnId of isnUserIds) {
        const body = await isnCall(cfg, 'GET', `/user/${encodeURIComponent(isnId)}`);
        // The spec shows the fields flat on the body; some ISN endpoints wrap them. Accept both.
        const email = String(((body.user as Rec | undefined) ?? body).emailaddress ?? '').trim().toLowerCase();
        const row = email
            ? await db.select({ id: users.id }).from(users)
                .where(and(eq(users.tenantId, tenantId), sql`lower(${users.email}) = ${email}`)).get()
            : undefined;
        if (row) out.push(row.id);
        else logger.warn('ISN order: inspector has no OI user with that email', { isnUserId: isnId, hasEmail: !!email });
    }
    return out;
}

async function fetchPerson(cfg: IsnConfig, kind: 'client' | 'agent', id: string | null) {
    if (!id) return null;
    return personFromIsn((await isnCall(cfg, 'GET', `/${kind}/${encodeURIComponent(id)}`))[kind] as Rec | undefined);
}

export async function applyIsnOrder(
    d1: D1Database, tenantId: string, cfg: IsnConfig,
    row: { id: string; inspectionId: string | null; payload: Rec },
): Promise<string | null> {
    const db = drizzle(d1);
    // Another delivery is creating this order's inspection right now; it applies
    // the newest stored payload once it is done (below), this one included.
    if (row.inspectionId?.startsWith('pending:')) return null;
    if (row.inspectionId) return updateFromOrder(db, cfg, tenantId, row.inspectionId, row.payload);

    const created = await createFromOrder(d1, db, cfg, tenantId, row);
    if (!created) return null;
    const latest = await db.select({ payload: isnOrders.payload }).from(isnOrders)
        .where(and(eq(isnOrders.id, row.id), eq(isnOrders.tenantId, tenantId))).get();
    return updateFromOrder(db, cfg, tenantId, created, (latest?.payload as Rec | undefined) ?? row.payload);
}

/** Creates the bare inspection and links it to the order; facts, team and status come from `updateFromOrder`. */
async function createFromOrder(
    d1: D1Database, db: Db, cfg: IsnConfig, tenantId: string,
    row: { id: string; payload: Rec },
): Promise<string | null> {
    const f = orderFacts(row.payload);
    // Never create an inspection for an order that was cancelled before OI saw it.
    if (f.canceled || !f.propertyAddress) return null;

    const [client, buyersAgent, sellersAgent] = [
        await fetchPerson(cfg, 'client', f.clientId),
        await fetchPerson(cfg, 'agent', f.buyersAgentId),
        await fetchPerson(cfg, 'agent', f.sellersAgentId),
    ];

    // Claim the row so two deliveries for one new order (ORDER_CREATED and
    // ORDER_SCHEDULED arrive together) cannot both create an inspection.
    // ponytail: a Worker killed between claim and create leaves the row claimed
    // (`pending:`); the reconcile cron (slice 3) should clear stale claims.
    const claim = `pending:${crypto.randomUUID()}`;
    const claimed = await db.update(isnOrders).set({ inspectionId: claim })
        .where(and(eq(isnOrders.id, row.id), eq(isnOrders.tenantId, tenantId), isNull(isnOrders.inspectionId)))
        .returning({ id: isnOrders.id });
    if (claimed.length === 0) return null;

    let createdId: string;
    try {
        const contactsSvc = new ContactService(d1);
        const agentId = async (p: typeof buyersAgent) => (p ? (await contactsSvc.upsertClientContact(tenantId, { ...p, type: 'agent' })).id : null);
        const catalog = await db.select({ id: services.id, name: services.name, templateId: services.templateId })
            .from(services).where(eq(services.tenantId, tenantId));
        const byName = new Map(catalog.map((s) => [s.name.trim().toLowerCase(), s]));
        const matched = f.serviceNames.map((n) => byName.get(n.toLowerCase())).filter((s): s is NonNullable<typeof s> => !!s);
        if (matched.length < f.serviceNames.length) {
            logger.warn('ISN order: services with no OI service of the same name', { isnOrderRowId: row.id, unmatched: f.serviceNames.length - matched.length });
        }

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

async function updateFromOrder(db: Db, cfg: IsnConfig, tenantId: string, inspectionId: string, payload: Rec): Promise<string> {
    const f = orderFacts(payload);
    const inspectorIds = await matchInspectors(db, cfg, tenantId, f.inspectorIds);
    const where = and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId));

    // A blank ISN field means ISN does not know, not that OI's value is wrong.
    const facts: Partial<typeof inspections.$inferInsert> = Object.fromEntries(Object.entries({
        date: f.date, propertyAddress: f.propertyAddress, ...f.address,
        yearBuilt: f.yearBuilt, sqft: f.sqft, foundationType: f.foundationType, referenceNumber: f.referenceNumber,
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
    if (f.canceled) await cancelIfUntouched(db, tenantId, inspectionId);
    // New (still Requested) or reinstated in ISN: the order is on the calendar.
    else await db.update(inspections).set({ status: INSPECTION_STATUS.SCHEDULED })
        .where(and(where, inArray(inspections.status, [INSPECTION_STATUS.REQUESTED, INSPECTION_STATUS.CANCELLED])));
    return inspectionId;
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
