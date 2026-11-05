import { z } from '@hono/zod-openapi';

export const IsnOrderTypeParamsSchema = z.object({
    orderTypeId: z.string().trim().min(1).describe('ISN order type identifier.'),
});
export const IsnTemplateMappingSchema = z.object({
    templateId: z.string().trim().min(1).nullable().describe('Primary report template, or null to clear the mapping.'),
}).strict();

export const IsnOrderTypesResponseSchema = z.object({
    ordertypes: z.array(z.object({ id: z.string().min(1), name: z.string() })),
});
