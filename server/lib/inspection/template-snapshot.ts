import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { templates } from '../db/schema';

/**
 * The columns an inspection must write when it takes on a template after it was
 * created: naming a template without its copy makes `requireTemplateSnapshot`
 * throw on the hub, the report and publish. Null when this tenant has no such template.
 */
export async function templateSnapshotValues(db: DrizzleD1Database, tenantId: string, templateId: string) {
    const tpl = await db.select({ schema: templates.schema, version: templates.version }).from(templates)
        .where(and(eq(templates.id, templateId), eq(templates.tenantId, tenantId))).get();
    return tpl ? { templateSnapshot: tpl.schema, templateSnapshotVersion: tpl.version } : null;
}
