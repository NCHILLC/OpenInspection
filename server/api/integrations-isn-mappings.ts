import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { getDrizzle } from '../lib/route-helpers';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { AppError, Errors } from '../lib/errors';
import { IsnOrderTypeParamsSchema, IsnTemplateMappingSchema } from '../lib/validations/isn-mapping.schema';
import { isnConfig, redactIsnSecrets, type IsnConfig } from '../services/isn/api-base';
import { listIsnTemplateMappings, setIsnTemplateMapping } from '../services/isn/template-mapping';

const listRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/order-types', tags: ['integrations'],
    summary: 'List ISN order types and primary template mappings',
    description: 'Reads the company catalogue from ISN and its tenant-scoped mappings. Retired or missing mapped templates are reported as unavailable.',
    middleware: [requireRole('owner', 'manager')] as const,
    responses: { 200: { description: 'Order type mappings and available templates', content: { 'application/json': { schema: z.object({
        success: z.literal(true), data: z.object({
            orderTypes: z.array(z.object({ id: z.string(), name: z.string(), templateId: z.string().nullable(), unavailable: z.boolean() })),
            templates: z.array(z.object({ id: z.string(), name: z.string() })),
        }),
    }) } } }, 503: { description: 'ISN is not configured or the catalogue could not be read' } },
    operationId: 'listIsnOrderTypeTemplates',
}, { scopes: ['admin'], tier: 'extended' }));

const saveRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/order-types/{orderTypeId}/template', tags: ['integrations'],
    summary: 'Set or clear an ISN order type’s primary report template',
    description: 'Changes the default for future imports only. Existing inspections and service-name matching are unchanged.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: IsnOrderTypeParamsSchema, body: { content: { 'application/json': { schema: IsnTemplateMappingSchema } } } },
    responses: {
        200: { description: 'Mapping saved', content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } } },
        400: { description: 'Invalid mapping or order type' },
        409: { description: 'The template is unavailable in this company' },
        503: { description: 'ISN is not configured or the catalogue could not be read' },
    },
    operationId: 'setIsnOrderTypeTemplate',
}, { scopes: ['admin'], tier: 'extended' }));

async function configured<T>(env: Parameters<typeof isnConfig>[0], operation: (cfg: IsnConfig) => Promise<T>): Promise<T> {
    const cfg = isnConfig(env);
    if (!cfg) throw Errors.ServiceUnavailable('Set the ISN connection keys before configuring template mappings.');
    try { return await operation(cfg); } catch (error) {
        if (error instanceof AppError) throw error;
        throw Errors.ServiceUnavailable(redactIsnSecrets(error instanceof Error ? error.message : 'ISN catalogue unavailable. Try again.', cfg));
    }
}

const isnMappingRoutes = createApiRouter()
    .openapi(listRoute, async (c) => c.json({ success: true as const,
        data: await configured(c.env, (cfg) => listIsnTemplateMappings(getDrizzle(c), c.get('tenantId'), cfg)),
    }, 200))
    .openapi(saveRoute, async (c) => {
        const { orderTypeId } = c.req.valid('param');
        const { templateId } = c.req.valid('json');
        await configured(c.env, (cfg) => setIsnTemplateMapping(getDrizzle(c), c.get('tenantId'), cfg, orderTypeId, templateId));
        return c.json({ success: true as const }, 200);
    });

export default isnMappingRoutes;
