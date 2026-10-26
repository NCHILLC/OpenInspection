/**
 * GET /api/inspections/:id/isn — the ISN card: read-only order facts from the
 * ISN order this inspection came from, or null when it came from nowhere.
 * Staff only: the payload carries the property's gate/lockbox code, which is
 * why it lives in `isn_orders` and not on the inspection row.
 *
 * POST /api/inspections/:id/isn/report-link — sends the published report's link
 * to ISN again, the retry for a publish whose ISN step failed. Republishing is
 * not a retry: it makes a new version and fires the delivery automations.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import { isnOrders, reports } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { requireCapability } from '../../lib/middleware/require-capability';
import { isnCardFields } from '../../services/isn/order-payload';
import { safeTimestamp } from '../../lib/date';

const yn = z.boolean().nullable();
const IsnCardSchema = z.object({
    orderNumber: z.string().nullable().describe("ISN's order number (oid)."),
    reportNumber: z.string().nullable(),
    canceled: z.boolean().describe('The order is cancelled in ISN.'),
    accessCode: z.string().nullable().describe('Gate / lockbox code. Staff only.'),
    occupied: yn, utilitiesOn: yn, paid: yn, signed: yn,
    crossStreets: z.string().nullable(),
    policyHolder: z.string().nullable(),
    policyNumber: z.string().nullable(),
    directionsUrl: z.string().nullable(),
    fetchedAt: z.number().describe('Epoch-ms OI last read the order from ISN.'),
});

const isnCardRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/isn',
    tags: ['inspections'],
    summary: "Read-only facts from the inspection's ISN order",
    description: 'Returns the order facts OI last read from Inspection Support Network for this inspection (order number, access code, occupancy, utilities, payment and signature status, policy, directions), or null when the inspection did not come from an ISN order. Staff only, because the access code is a gate or lockbox code.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Inspection identifier.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: IsnCardSchema.nullable() }) } },
            description: 'ISN card, or null when the inspection did not come from ISN',
        },
    },
    operationId: 'getInspectionIsnCard',
}, { scopes: ['read'], tier: 'extended' }));

const reportLinkRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/isn/report-link',
    tags: ['inspections'],
    summary: "Send the published report's link to its ISN order again",
    description: "Retries the step publishing runs last: adds the inspection's published report link to the ISN order named in its Reference Number and reads it back. For a publish whose ISN step failed (for example a mistyped order number or a missing client email, fixed since). Does not republish, so no new version and no delivery automations. Returns null when ISN is not configured or the inspection has no Reference Number; 409 when the report is not published.",
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('publish')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Inspection identifier.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({
                ok: z.boolean(), isnReportId: z.string().optional(), error: z.string().optional(),
            }).nullable() }) } },
            description: 'Outcome of the ISN step (ok false carries the reason), or null when ISN does not apply',
        },
        409: { description: 'The report is not published' },
    },
    operationId: 'retryInspectionIsnReportLink',
}, { scopes: ['write'], tier: 'extended', capability: 'publish' }));

const isnCardRoutes = createApiRouter()
    .openapi(isnCardRoute, async (c) => {
        const { id } = c.req.valid('param');
        const row = await getDrizzle(c).select({ payload: isnOrders.payload, fetchedAt: isnOrders.fetchedAt })
            .from(isnOrders)
            .where(and(eq(isnOrders.tenantId, c.get('tenantId')), eq(isnOrders.inspectionId, id)))
            .get();
        const data = row ? { ...isnCardFields(row.payload), fetchedAt: safeTimestamp(row.fetchedAt) } : null;
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(reportLinkRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const published = await getDrizzle(c).select({ id: reports.id }).from(reports)
            .where(and(eq(reports.tenantId, tenantId), eq(reports.inspectionId, id), eq(reports.kind, 'primary'), eq(reports.status, 'published')))
            .get();
        if (!published) throw Errors.Conflict('Publish the report before sending it to ISN');
        return c.json({ success: true as const, data: await (await import('../../services/isn/report-link-sync')).syncPublishedReportToIsn(c, tenantId, id) }, 200);
    });

export default isnCardRoutes;
