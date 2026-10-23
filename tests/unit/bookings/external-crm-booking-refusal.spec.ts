/**
 * While another system is the CRM, OI's public booking answers 404 and every
 * other route under the same `/api/public` mount keeps answering. The second
 * half is why the refusal is a path list: the bookings router's `use('*')`
 * covers the report, portal, signing and geocode routes too.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';
import { refusePublicBookingWhenExternalCrm } from '../../../server/lib/middleware/external-crm';

function appWith(externalCrm: 'isn' | null) {
    const app = new Hono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('profile', { ...STANDALONE_PROFILE, externalCrm });
        await next();
    });
    app.use('/api/public/*', refusePublicBookingWhenExternalCrm);
    app.all('*', (c) => c.text('ok'));
    app.onError((err, c) => c.text(err.message, err instanceof AppError ? err.status : 500));
    return app;
}

const BOOKING = [
    '/api/public/book',
    '/api/public/book/acme',
    '/api/public/book/acme/jane',
    '/api/public/inspectors',
    '/api/public/services',
    '/api/public/availability/u1',
    '/api/public/slots',
    '/api/public/inspections/i1/deposit-intent',
    '/api/public/widget/event',
];

const STAYS_UP = [
    '/api/public/agreements/tok',
    '/api/public/checkout/tok',
    '/api/public/geocode',
    '/api/public/inspections/i1/messages',
    '/api/public/inspections/i1/documents',
    '/api/public/brand/acme',
    '/api/public/bookings-history',
];

describe('public booking while another system is the CRM', () => {
    it('refuses every booking path with 404', async () => {
        const app = appWith('isn');
        for (const path of BOOKING) {
            expect((await app.request(path)).status, path).toBe(404);
        }
    });

    it('leaves the rest of /api/public answering', async () => {
        const app = appWith('isn');
        for (const path of STAYS_UP) {
            expect((await app.request(path)).status, path).toBe(200);
        }
    });

    it('refuses nothing when OI is the CRM', async () => {
        const app = appWith(null);
        for (const path of BOOKING) {
            expect((await app.request(path)).status, path).toBe(200);
        }
    });
});
