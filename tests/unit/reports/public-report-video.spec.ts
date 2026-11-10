/**
 * The clip and poster a published report plays, for a client holding a report link.
 *
 * The staff video routes need a session, so the public report points its clip and poster at these routes instead. They
 * must open for the link's holder and for nobody else: same proof and same gates as the report's photos.
 *
 * Every refusal has its opposite (a positive control), so a route that refuses everybody cannot pass.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import publicReportRoutes from '../../../server/api/public-report';
import { selectReportMedia } from '../../../server/lib/report-video';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000c2';
const INSP = '00000000-0000-0000-0000-0000000000d1';
const OTHER_INSP = '00000000-0000-0000-0000-0000000000d2';
const SLUG = 'acme';
const CLIP_KEY = `${TENANT}/inspections/${INSP}/videos/m1.mp4`;
const POSTER_KEY = `${TENANT}/inspections/${INSP}/videos/m1.poster.jpg`;
const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

function fakeBucket(): R2Bucket {
    const objects: Record<string, { bytes: Uint8Array; type: string }> = {
        [CLIP_KEY]: { bytes: BYTES, type: 'video/mp4' },
        [POSTER_KEY]: { bytes: BYTES, type: 'image/jpeg' },
        [`${OTHER_TENANT}/inspections/${INSP}/videos/m3.mp4`]: { bytes: BYTES, type: 'video/mp4' },
    };
    return {
        head: async (key: string) => (objects[key] ? { size: objects[key]!.bytes.length } : null),
        get: async (key: string, opts?: { range?: { offset: number; length?: number } }) => {
            const o = objects[key];
            if (!o) return null;
            const r = opts?.range;
            const body = r ? o.bytes.slice(r.offset, r.length === undefined ? undefined : r.offset + r.length) : o.bytes;
            return { body, size: o.bytes.length, httpMetadata: { contentType: o.type } };
        },
    } as unknown as R2Bucket;
}

describe('GET /api/public/report/:tenant/:id/video/r2-object/:mediaId', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close(): void };

    async function seed(reportStatus = 'published') {
        await db.insert(schema.tenants).values({
            id: TENANT, slug: SLUG, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        for (const id of [INSP, OTHER_INSP]) {
            await db.insert(schema.inspections).values({
                id, tenantId: TENANT, propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@test.com',
                date: '2026-06-01', status: 'completed', reportStatus: id === INSP ? reportStatus : 'published',
                paymentStatus: 'unpaid', price: 50000, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            } as never);
        }
        const row = (id: string, inspectionId: string, tenantId: string, r2Key: string, posterKey: string | null) => ({
            id, inspectionId, tenantId, r2Key, url: '', uploadedAt: new Date(), mediaType: 'video', provider: 'r2', posterKey,
        });
        await db.insert(schema.inspectionMediaPool).values([
            row('m1', INSP, TENANT, CLIP_KEY, POSTER_KEY),
            // A clip of ANOTHER inspection of the same company.
            row('m2', OTHER_INSP, TENANT, `${TENANT}/inspections/${OTHER_INSP}/videos/m2.mp4`, null),
            // A row that names this inspection but a key under another company: must never be served.
            row('m3', INSP, TENANT, `${OTHER_TENANT}/inspections/${INSP}/videos/m3.mp4`, `${OTHER_TENANT}/inspections/${INSP}/videos/m3.poster.jpg`),
        ] as never);
    }

    function buildApp(opts: { releaseGate?: 'payment' | 'agreement' | null; tokenFor?: string | null } = {}) {
        const tokenFor = opts.tokenFor === undefined ? INSP : opts.tokenFor;
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {}, PHOTOS: fakeBucket(), JWT_SECRET: 'test-secret' };
            c.set('services', {
                portalAccess: {
                    resolveToken: vi.fn(async (t: string) => (t === 'tok' && tokenFor
                        ? { inspectionId: tokenFor, tenantId: TENANT, role: 'client', recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null }
                        : null)),
                },
                inspection: {
                    resolveReleaseGate: vi.fn().mockResolvedValue(opts.releaseGate ? { reason: opts.releaseGate, paymentOutstanding: false } : null),
                    resolveAgentViewToken: vi.fn().mockResolvedValue(null),
                },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return app;
    }

    const clip = (id = INSP, media = 'm1', q = '?token=tok') => `/api/public/report/${SLUG}/${id}/video/r2-object/${media}${q}`;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite as { close(): void };
        await setupSchema(sqlite as never);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });
    afterEach(() => sqlite.close());

    it('plays the clip for the holder of the link, privately cached', async () => {
        await seed();
        const res = await buildApp().request(clip());
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('video/mp4');
        expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    });

    it('seeks with a Range request', async () => {
        await seed();
        const res = await buildApp().request(clip(), { headers: { Range: 'bytes=2-5' } });
        expect(res.status).toBe(206);
        expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10');
    });

    it('serves the poster', async () => {
        await seed();
        const res = await buildApp().request(`/api/public/report/${SLUG}/${INSP}/video/r2-object/m1/poster?token=tok`);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    });

    it('refuses a request with no proof, or a proof that names nothing', async () => {
        await seed();
        expect((await buildApp().request(clip(INSP, 'm1', ''))).status).toBe(404);
        expect((await buildApp().request(clip(INSP, 'm1', '?token=wrong'))).status).toBe(404);
        expect((await buildApp().request(`/api/public/report/${SLUG}/${INSP}/video/r2-object/m1/poster`)).status).toBe(404);
    });

    it('refuses a link issued for a different inspection', async () => {
        await seed();
        expect((await buildApp({ tokenFor: OTHER_INSP }).request(clip())).status).toBe(404);
    });

    it('refuses while the report is held back, and plays once nothing holds it', async () => {
        await seed();
        expect((await buildApp({ releaseGate: 'payment' }).request(clip())).status).toBe(404);
        expect((await buildApp({ releaseGate: 'agreement' }).request(clip())).status).toBe(404);
        // CONTROL: the same request with no hold plays, so the refusals above are the gate, not a broken route.
        expect((await buildApp({ releaseGate: null }).request(clip())).status).toBe(200);
    });

    it('refuses while the report is not published', async () => {
        await seed('in_progress');
        expect((await buildApp().request(clip())).status).toBe(404);
    });

    it('refuses a media id of another inspection, even of the same company', async () => {
        await seed();
        expect((await buildApp().request(clip(INSP, 'm2'))).status).toBe(404);
    });

    it('refuses a row whose stored key belongs to another company', async () => {
        await seed();
        expect((await buildApp().request(clip(INSP, 'm3'))).status).toBe(404);
        expect((await buildApp().request(`/api/public/report/${SLUG}/${INSP}/video/r2-object/m3/poster?token=tok`)).status).toBe(404);
    });
});

describe('the report builds its clip and poster URLs on those routes', () => {
    const entry = { mediaType: 'video', provider: 'r2', mediaId: 'm1', url: '', key: '', durationSec: 5 } as never;
    const base = { isPdf: false, streamCustomerSubdomain: '', appBaseUrl: 'https://x.test', r2BaseUrl: '/api/public/report/acme/i1/video' };

    it('carries the link token on both URLs', () => {
        const media = selectReportMedia(entry, { ...base, r2ProofQuery: '?token=abc%20d' });
        expect(media).toMatchObject({
            kind: 'r2-video-player',
            playerSrc: '/api/public/report/acme/i1/video/r2-object/m1?token=abc%20d',
            posterUrl: '/api/public/report/acme/i1/video/r2-object/m1/poster?token=abc%20d',
        });
    });
    it('carries the render token on the PDF poster', () => {
        const media = selectReportMedia(entry, { ...base, isPdf: true, r2ProofQuery: '?render=r1' });
        expect(media).toMatchObject({ kind: 'r2-video-poster', posterUrl: '/api/public/report/acme/i1/video/r2-object/m1/poster?render=r1' });
    });
    it('adds nothing for a session reader', () => {
        const media = selectReportMedia(entry, { ...base, r2BaseUrl: '/api/inspections/i1/media/video', r2ProofQuery: '' });
        expect(media).toMatchObject({ playerSrc: '/api/inspections/i1/media/video/r2-object/m1' });
    });
});
