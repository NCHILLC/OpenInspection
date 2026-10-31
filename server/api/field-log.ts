/**
 * The field log: the user's opt-in, the device upload, and the per-inspection
 * timeline. Docs: docs/operate/field-log.md.
 */
import { createRoute } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { fieldLogEvents, inspections, users } from '../lib/db/schema';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import {
    FieldLogInspectionParamSchema,
    FieldLogSettingSchema,
    FieldLogTimelineSchema,
    FieldLogUploadSchema,
} from '../lib/validations/field-log.schema';

const ISSUE_CONTEXT_MS = 5 * 60_000;
const staff = requireRole('owner', 'manager', 'inspector');

const getSettingRoute = withMcpMetadata(createRoute({
    method: 'get',
    path: '/setting',
    tags: ['inspections'],
    operationId: 'getFieldLogSetting',
    summary: 'Read my field log setting',
    description: 'Whether the field log records the signed-in user. Off unless that user turned it on.',
    middleware: staff,
    responses: { 200: { description: 'Whether the field log records this user', content: { 'application/json': { schema: FieldLogSettingSchema } } } },
}), { scopes: ['read'], tier: 'extended' });

const putSettingRoute = withMcpMetadata(createRoute({
    method: 'put',
    path: '/setting',
    tags: ['inspections'],
    operationId: 'setFieldLogSetting',
    summary: 'Turn my field log on or off',
    description: 'Sets the signed-in user\'s own field log switch. It applies to no one else in the company.',
    middleware: staff,
    request: { body: { content: { 'application/json': { schema: FieldLogSettingSchema } }, required: true } },
    responses: { 200: { description: 'The new setting', content: { 'application/json': { schema: FieldLogSettingSchema } } } },
}), { scopes: ['write'], tier: 'extended' });

const uploadRoute = withMcpMetadata(createRoute({
    method: 'post',
    path: '/events',
    tags: ['inspections'],
    operationId: 'uploadFieldLogEvents',
    summary: 'Upload buffered field log events',
    description: 'Stores a batch from the device buffer for a user whose field log is on. Refused with 403 otherwise.',
    middleware: staff,
    request: { body: { content: { 'application/json': { schema: FieldLogUploadSchema } }, required: true } },
    responses: { 204: { description: 'Stored. Replayed ids and foreign inspections are ignored.' } },
}), { scopes: ['write'], tier: 'extended' });

const timelineRoute = withMcpMetadata(createRoute({
    method: 'get',
    path: '/inspections/{id}',
    tags: ['inspections'],
    operationId: 'getFieldLogTimeline',
    summary: 'Read the field log of one inspection',
    description: 'Every recorded event for the inspection, oldest first, plus each Mark issue marker with the ids of the events from the five minutes before it.',
    middleware: staff,
    request: { params: FieldLogInspectionParamSchema },
    responses: { 200: { description: 'The timeline', content: { 'application/json': { schema: FieldLogTimelineSchema } } } },
}), { scopes: ['read'], tier: 'extended' });

interface TimelineRow { id: string; occurredAt: number; kind: string }

/** Rows must be oldest first. */
export function issuesWithContext<T extends TimelineRow>(events: T[]) {
    return events.filter((e) => e.kind === 'issue').map((issue) => ({
        ...issue,
        precedingEventIds: events
            .filter((e) => e.id !== issue.id && e.occurredAt <= issue.occurredAt && e.occurredAt >= issue.occurredAt - ISSUE_CONTEXT_MS)
            .map((e) => e.id),
    }));
}

const fieldLogRoutes = createApiRouter()
    .openapi(getSettingRoute, async (c) => {
        const db = drizzle(c.env.DB as never);
        const row = await db.select({ enabled: users.fieldLogEnabled }).from(users)
            .where(and(eq(users.id, c.get('user').sub), eq(users.tenantId, c.get('tenantId'))))
            .get();
        return c.json({ enabled: row?.enabled ?? false }, 200);
    })
    .openapi(putSettingRoute, async (c) => {
        const { enabled } = c.req.valid('json');
        const db = drizzle(c.env.DB as never);
        await db.update(users).set({ fieldLogEnabled: enabled })
            .where(and(eq(users.id, c.get('user').sub), eq(users.tenantId, c.get('tenantId'))));
        return c.json({ enabled }, 200);
    })
    .openapi(uploadRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const userId = c.get('user').sub;
        const { events } = c.req.valid('json');
        const db = drizzle(c.env.DB as never);
        const user = await db.select({ enabled: users.fieldLogEnabled }).from(users)
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
            .get();
        if (!user?.enabled) throw Errors.Forbidden('Field log is off for this user');

        const known = await db.select({ id: inspections.id }).from(inspections).where(and(
            eq(inspections.tenantId, tenantId),
            inArray(inspections.id, [...new Set(events.map((e) => e.inspectionId))]),
        ));
        const allowed = new Set(known.map((k) => k.id));
        const rows = events.filter((e) => allowed.has(e.inspectionId)).map((e) => ({
            ...e, tenantId, userId, occurredAt: new Date(e.occurredAt),
        }));
        // Ten columns a row: one statement each stays inside D1's bound-parameter cap.
        const inserts = rows.map((r) => db.insert(fieldLogEvents).values(r).onConflictDoNothing());
        const [first, ...rest] = inserts;
        if (first) await db.batch([first, ...rest]);
        return c.body(null, 204);
    })
    .openapi(timelineRoute, async (c) => {
        const { id } = c.req.valid('param');
        const db = drizzle(c.env.DB as never);
        const rows = await db.select().from(fieldLogEvents)
            .where(and(eq(fieldLogEvents.tenantId, c.get('tenantId')), eq(fieldLogEvents.inspectionId, id)))
            .orderBy(asc(fieldLogEvents.occurredAt));
        const events = rows.map(({ tenantId: _tenantId, inspectionId: _inspectionId, ...r }) => ({
            ...r, occurredAt: r.occurredAt.getTime(),
        }));
        return c.json({ events, issues: issuesWithContext(events) }, 200);
    });

export type FieldLogApi = typeof fieldLogRoutes;

export default fieldLogRoutes;
