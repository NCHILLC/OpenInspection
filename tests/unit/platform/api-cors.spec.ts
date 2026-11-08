/**
 * CORS for /api/*, through the real app. The API never reflects an arbitrary origin: only this deployment's own origin,
 * APP_BASE_URL and the operator's CORS_ALLOWED_ORIGINS get credentials. The public booking routes answer `*` without them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createHarness, type Harness } from '../helpers/tenant-email-harness';

const OTHER_ORIGIN = 'https://other.example';
const PRIVATE = '/api/inspections';
const csv = (v: string | null): string[] => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

describe('API CORS (real app)', () => {
    let h: Harness | undefined;
    afterEach(() => { h?.close(); h = undefined; });

    async function send(path: string, init: RequestInit, extraEnv: Record<string, string> = {}, base = 'http://localhost'): Promise<Response> {
        h ??= await createHarness('standalone');
        const env = { ...h.env, ...extraEnv } as typeof h.env;
        const exec = makeExecutionContext({ label: 'api-cors' });
        const res = await app.request(`${base}${path}`, init, env, exec.ctx);
        await exec.settle();
        return res;
    }

    it('never reflects an arbitrary origin: no Allow-Origin, no credentials, Vary: Origin', async () => {
        const pre = await send(PRIVATE, { method: 'OPTIONS', headers: { Origin: OTHER_ORIGIN, 'Access-Control-Request-Method': 'GET' } });
        expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
        expect(pre.headers.get('Access-Control-Allow-Credentials')).toBeNull();
        expect(pre.headers.get('Vary')).toContain('Origin');

        const res = await send(PRIVATE, { headers: { Origin: OTHER_ORIGIN } });
        expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
        expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
        expect(res.headers.get('Access-Control-Expose-Headers')).toBeNull();
        expect(res.headers.get('Vary')).toContain('Origin');
    });

    it('gives the deployment own origin credentials, with a full preflight', async () => {
        const own = 'http://localhost';
        const pre = await send(PRIVATE, { method: 'OPTIONS', headers: { Origin: own, 'Access-Control-Request-Method': 'PATCH' } });
        expect(pre.status).toBe(204);
        expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(own);
        expect(pre.headers.get('Access-Control-Allow-Credentials')).toBe('true');
        expect(csv(pre.headers.get('Access-Control-Allow-Headers'))).toEqual(['content-type', 'authorization', 'x-csrf-token', 'x-token-relay']);
        expect(csv(pre.headers.get('Access-Control-Allow-Methods'))).toContain('patch');

        const res = await send(PRIVATE, { headers: { Origin: own } });
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(own);
        expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
        expect(csv(res.headers.get('Access-Control-Expose-Headers'))).toEqual(['set-cookie']);
    });

    it('gives credentials to APP_BASE_URL and to CORS_ALLOWED_ORIGINS, and to nobody else', async () => {
        const env = { APP_BASE_URL: 'https://app.example.com', CORS_ALLOWED_ORIGINS: 'https://admin.example.com, not a url, https://other-admin.example.com/' };
        for (const origin of ['https://app.example.com', 'https://admin.example.com', 'https://other-admin.example.com']) {
            const res = await send(PRIVATE, { headers: { Origin: origin } }, env);
            expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBe(origin);
            expect(res.headers.get('Access-Control-Allow-Credentials'), origin).toBe('true');
        }
        for (const origin of ['https://admin.example.com.evil.example', 'http://admin.example.com', 'https://evil.example']) {
            const res = await send(PRIVATE, { headers: { Origin: origin } }, env);
            expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBeNull();
            expect(res.headers.get('Access-Control-Allow-Credentials'), origin).toBeNull();
        }
    });

    it('allows the Vite dev origin only on a loopback host', async () => {
        const dev = 'http://localhost:5173';
        expect((await send(PRIVATE, { headers: { Origin: dev } })).headers.get('Access-Control-Allow-Origin')).toBe(dev);
        const prod = await send(PRIVATE, { headers: { Origin: dev } }, {}, 'https://app.example.com');
        expect(prod.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('answers the public booking routes for any origin with a wildcard and never credentials', async () => {
        for (const path of ['/api/public/widget/event', '/api/public/book', '/api/public/slots']) {
            const pre = await send(path, {
                method: 'OPTIONS',
                headers: { Origin: OTHER_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
            });
            expect(pre.status, path).toBeLessThan(300);
            expect(pre.headers.get('Access-Control-Allow-Origin'), path).toBe('*');
            expect(pre.headers.get('Access-Control-Allow-Credentials'), path).toBeNull();
            expect(csv(pre.headers.get('Access-Control-Allow-Headers')), path).toContain('content-type');
        }
        const res = await send('/api/public/widget/event', {
            method: 'POST',
            headers: { Origin: OTHER_ORIGIN, 'content-type': 'application/json' },
            body: JSON.stringify({ event: 'view' }),
        });
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });

    it('never pairs a wildcard with credentials on any route or origin', async () => {
        for (const path of [PRIVATE, '/api/public/widget/event', '/api/public/book']) {
            for (const origin of [OTHER_ORIGIN, 'http://localhost']) {
                for (const method of ['GET', 'OPTIONS']) {
                    const res = await send(path, { method, headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } });
                    if (res.headers.get('Access-Control-Allow-Origin') === '*') {
                        expect(res.headers.get('Access-Control-Allow-Credentials'), `${method} ${path} ${origin}`).toBeNull();
                    }
                }
            }
        }
    });
});
