// Read-only pre-flight for publish; see the route description.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { requireReportResultsForPublish } from '../../lib/inspection/report-results';
import { resolvePublishTargetReport } from '../../lib/inspection/report-notifications';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

/**
 * GET /api/inspections/:id/publish-check
 *
 * Read-only: the same results-row gate publish applies first, so a caller can
 * learn of an unreadable or ambiguous row before it does anything else (the
 * edit page marks the order complete and sets auto-sign before publishing).
 * Changes nothing.
 */
const publishCheckRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/publish-check',
    tags: ['inspections'],
    summary: 'Check that the report to publish has readable results',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('publish')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection identifier') }),
        query: z.object({ reportId: z.string().min(1).optional().describe('Report to check; defaults to the inspection primary report') }),
    },
    responses: {
        200: {
            description: 'The results row is readable (or absent)',
            content: { 'application/json': { schema: z.object({ ok: z.literal(true).describe('Always true when the check passes') }) } },
        },
    },
    operationId: 'getInspectionPublishCheck',
    description: 'Refuses with 409 (unreadable_results_row or ambiguous_results_rows) when the report results cannot be published safely. Read-only; the same check publish makes before changing anything.',
}, { scopes: ['read'], tier: 'extended', capability: 'publish' }));

const publishCheckRoutes = createApiRouter()
    .openapi(publishCheckRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { reportId } = c.req.valid('query');
        const db = getDrizzle(c);
        const target = await resolvePublishTargetReport(db, tenantId, id, reportId);
        await requireReportResultsForPublish(db, tenantId, id, target);
        return c.json({ ok: true as const }, 200);
    });

export default publishCheckRoutes;
