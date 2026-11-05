import { z } from '@hono/zod-openapi';

export const IsnInspectionParamsSchema = z.object({
    id: z.string().trim().min(1).describe('Inspection identifier.'),
});
