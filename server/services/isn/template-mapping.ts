import { and, eq, asc } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { isnOrderTypeTemplates, templates } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { IsnOrderTypesResponseSchema } from '../../lib/validations/isn-mapping.schema';
import { isnCall, type IsnConfig } from './api-base';
import { decodeIsnText } from './order-payload';

/** The catalogue is read from ISN, never inferred from previously imported orders. */
export async function listIsnOrderTypes(cfg: IsnConfig) {
    const parsed = IsnOrderTypesResponseSchema.safeParse(await isnCall(cfg, 'GET', '/ordertypes'));
    if (!parsed.success) throw Errors.ServiceUnavailable('ISN returned an unexpected order type catalogue. Try again or check the connection.');
    return parsed.data.ordertypes.map((type) => ({ id: type.id, name: decodeIsnText(type.name) }));
}

export async function requireIsnTemplate(db: DrizzleD1Database, tenantId: string, templateId: string) {
    const row = await db.select().from(templates)
        .where(and(eq(templates.tenantId, tenantId), eq(templates.id, templateId))).get();
    if (!row || row.retiredAt != null) throw Errors.Conflict('The mapped report template is unavailable. Choose an available template in ISN settings.');
    return row;
}

export async function mappedIsnTemplate(db: DrizzleD1Database, tenantId: string, payload: Record<string, unknown>) {
    const typeId = typeof payload.ordertype === 'string' ? payload.ordertype.trim() : '';
    if (!typeId) return null;
    const mapping = await db.select().from(isnOrderTypeTemplates)
        .where(and(eq(isnOrderTypeTemplates.tenantId, tenantId), eq(isnOrderTypeTemplates.isnOrderTypeId, typeId))).get();
    return mapping ? requireIsnTemplate(db, tenantId, mapping.templateId) : null;
}

export async function listIsnTemplateMappings(db: DrizzleD1Database, tenantId: string, cfg: IsnConfig) {
    const [types, mappings, available] = await Promise.all([
        listIsnOrderTypes(cfg),
        db.select().from(isnOrderTypeTemplates).where(eq(isnOrderTypeTemplates.tenantId, tenantId)).all(),
        db.select({ id: templates.id, name: templates.name, retiredAt: templates.retiredAt }).from(templates)
            .where(eq(templates.tenantId, tenantId)).orderBy(asc(templates.name)).all(),
    ]);
    const byType = new Map(mappings.map((mapping) => [mapping.isnOrderTypeId, mapping.templateId]));
    const allTypes = [...types, ...mappings.filter((mapping) => !types.some((type) => type.id === mapping.isnOrderTypeId))
        .map((mapping) => ({ id: mapping.isnOrderTypeId, name: `Unavailable ISN order type (${mapping.isnOrderTypeId})` }))];
    return {
        orderTypes: allTypes.map((type) => {
            const templateId = byType.get(type.id) ?? null;
            const template = available.find((candidate) => candidate.id === templateId);
            return { ...type, templateId, unavailable: templateId !== null && (!template || template.retiredAt !== null) };
        }),
        templates: available.filter((template) => template.retiredAt === null).map(({ id, name }) => ({ id, name })),
    };
}

export async function setIsnTemplateMapping(db: DrizzleD1Database, tenantId: string, cfg: IsnConfig, orderTypeId: string, templateId: string | null) {
    const where = and(eq(isnOrderTypeTemplates.tenantId, tenantId), eq(isnOrderTypeTemplates.isnOrderTypeId, orderTypeId));
    if (templateId === null) {
        await db.delete(isnOrderTypeTemplates).where(where);
        return;
    }
    const types = await listIsnOrderTypes(cfg);
    if (!types.some((type) => type.id === orderTypeId)) throw Errors.BadRequest('This ISN order type is unavailable. Reload the catalogue.');
    await requireIsnTemplate(db, tenantId, templateId);
    const now = new Date();
    await db.insert(isnOrderTypeTemplates).values({ id: crypto.randomUUID(), tenantId, isnOrderTypeId: orderTypeId, templateId, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [isnOrderTypeTemplates.tenantId, isnOrderTypeTemplates.isnOrderTypeId], set: { templateId, updatedAt: now } });
}
