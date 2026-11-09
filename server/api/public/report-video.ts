/**
 * The video clip and poster a report link plays.
 *
 * Behind the same proof and the same gates as the report's photos (published, no agreement or payment hold), because a clip
 * is part of the report. The staff session routes under `/api/inspections/:id/media/video/` are not reachable without a
 * session: a media id is not a credential.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import { inspectionMediaPool } from '../../lib/db/schema';
import { authorizeReportMedia } from '../../lib/report-link-access';
import { serveVideoClip, serveVideoPoster } from '../../lib/media/serve-video';

/** A report link URL is private to its holder, so what it serves is not cached for anyone else. */
const PRIVATE_CACHE = 'private, max-age=300';

const params = z.object({
    tenant: z.string().describe('Tenant slug (display only; tenant is resolved from the proof).'),
    id: z.string().describe('Inspection id.'),
    mediaId: z.string().describe('Media id of an R2 video of this inspection (the pool row id).'),
});
const query = z.object({
    token: z.string().optional().describe('Persistent portal access token.'),
    render: z.string().optional().describe('Server-minted render token (headless PDF only).'),
});

const clipRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/report/{tenant}/{id}/video/r2-object/{mediaId}',
    tags: ['public'],
    summary: 'Public token-gated report video clip',
    request: { params, query },
    responses: {
        200: { content: { 'video/*': { schema: z.any() } }, description: 'Video bytes' },
        206: { description: 'Partial content for a Range request' },
        404: { description: 'Not found, token invalid, or the report is not released' },
        416: { description: 'Range not satisfiable' },
    },
    operationId: 'getPublicReportVideo',
    description: 'Public, no-login video clip gated by the same portal token and report gates as the report photos. Supports HTTP Range. 404 when the proof is missing or the report is not published or is held back.',
}, { scopes: [], tier: 'extended' }));

const posterRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/report/{tenant}/{id}/video/r2-object/{mediaId}/poster',
    tags: ['public'],
    summary: 'Public token-gated report video poster',
    request: { params, query },
    responses: {
        200: { content: { 'image/*': { schema: z.any() } }, description: 'Poster image bytes' },
        404: { description: 'Not found, token invalid, or the report is not released' },
    },
    operationId: 'getPublicReportVideoPoster',
    description: 'Public, no-login poster image for a report video, gated exactly like the clip.',
}, { scopes: [], tier: 'extended' }));

const app = createApiRouter();
app.openapi(clipRoute, async (c) => {
    const { id, mediaId } = c.req.valid('param');
    const access = await authorizeReportMedia(c, id, c.req.valid('query'));
    if (!access) return c.notFound();
    const row = await getDrizzle(c)
        .select({ r2Key: inspectionMediaPool.r2Key })
        .from(inspectionMediaPool)
        .where(and(
            eq(inspectionMediaPool.id, mediaId),
            eq(inspectionMediaPool.inspectionId, id),
            eq(inspectionMediaPool.tenantId, access.tenantId),
            eq(inspectionMediaPool.provider, 'r2'),
            eq(inspectionMediaPool.mediaType, 'video'),
        ))
        .get();
    // The row already names this company and inspection; the key must too, so a bad row can not reach another one's object.
    if (!row || !row.r2Key.startsWith(`${access.tenantId}/inspections/${id}/`)) return c.notFound();
    return (await serveVideoClip(c.env.PHOTOS, row.r2Key, c.req.header('Range'), PRIVATE_CACHE)) ?? c.notFound();
});
app.openapi(posterRoute, async (c) => {
    const { id, mediaId } = c.req.valid('param');
    const access = await authorizeReportMedia(c, id, c.req.valid('query'));
    if (!access) return c.notFound();
    const row = await getDrizzle(c)
        .select({ posterKey: inspectionMediaPool.posterKey })
        .from(inspectionMediaPool)
        .where(and(
            eq(inspectionMediaPool.id, mediaId),
            eq(inspectionMediaPool.inspectionId, id),
            eq(inspectionMediaPool.tenantId, access.tenantId),
            eq(inspectionMediaPool.provider, 'r2'),
        ))
        .get();
    if (!row?.posterKey || !row.posterKey.startsWith(`${access.tenantId}/inspections/${id}/`)) return c.notFound();
    return (await serveVideoPoster(c.env.PHOTOS, row.posterKey, PRIVATE_CACHE)) ?? c.notFound();
});

// Mounted inside `server/api/public-report.ts`, like the view-tracking routes.
export default app;
