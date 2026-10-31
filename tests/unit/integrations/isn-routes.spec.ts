/**
 * /api/integrations/isn/{test,status,pull}: refusal, ISN failures, success,
 * tenant scope of the saved history, and credential redaction. Fetch is
 * stubbed; the history writer is mocked so the rows it is asked to save can
 * be read back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import integrationsRoutes from '../../../server/api/integrations';
import { isnIntakeState, redactIsnSecrets } from '../../../server/services/isn/api-base';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const saved = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, listedFor: [] as string[] }));
vi.mock('../../../server/lib/integration-test-results', () => ({
    recordIntegrationTest: vi.fn(async (_db: unknown, args: Record<string, unknown>) => { saved.rows.push(args); }),
    listIntegrationTestResults: vi.fn(async (_db: unknown, tenantId: string) => {
        saved.listedFor.push(tenantId);
        return saved.rows.filter((r) => r.tenantId === tenantId);
    }),
}));

const TENANT = 'tenant-isn-a';
const KEYS = {
    ISN_DOMAIN: 'https://isn.example.test', ISN_COMPANY_KEY: 'COMPANY1', ISN_ACCESS_KEY: 'access-zq9-Vk3pLm7', ISN_SECRET_KEY: 'secret-Xw2-Rt8nBc4',
};
const WEBHOOK = 'whsec-Hj5-Qd6yTe1';

function call(method: 'GET' | 'POST', path: string, opts: { role?: string; tenant?: string; env?: Record<string, string | undefined> } = {}) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', (opts.role ?? 'owner') as never);
        c.set('tenantId', opts.tenant ?? TENANT);
        await next();
    });
    // The production handler maps an AppError to its status; without it every refusal is a 500.
    app.onError((err, c) => (err instanceof AppError ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status) : c.json({ success: false }, 500)));
    app.route('/api/integrations', integrationsRoutes);
    const init = method === 'POST' ? { method, headers: { 'content-type': 'application/json' }, body: '{}' } : { method };
    return app.request(`/api/integrations/isn/${path}`, init, { JWT_SECRET: 'x'.repeat(32), DB: {}, ...opts.env });
}

const isnReply = (message: string) => vi.fn(async () => new Response(JSON.stringify({ status: 'error', message }), { status: 200 }));

beforeEach(() => { saved.rows.length = 0; saved.listedFor.length = 0; });
afterEach(() => vi.unstubAllGlobals());

describe('POST /isn/test', () => {
    it('refuses a non-manager before calling ISN or saving anything', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const res = await call('POST', 'test', { role: 'inspector', env: KEYS });
        expect(res.status).toBe(403);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(saved.rows).toEqual([]);
    });

    it('answers 503 and saves a failed test when the keys are not all set', async () => {
        const res = await call('POST', 'test', { env: { ISN_DOMAIN: KEYS.ISN_DOMAIN } });
        expect(res.status).toBe(503);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ISN_NOT_CONFIGURED');
        expect(saved.rows).toMatchObject([{ tenantId: TENANT, target: 'isn', ok: false }]);
    });

    it("answers 502 with ISN's own message and saves it for this tenant", async () => {
        vi.stubGlobal('fetch', isnReply('Invalid credentials'));
        const res = await call('POST', 'test', { env: KEYS });
        expect(res.status).toBe(502);
        expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Invalid credentials');
        expect(saved.rows).toMatchObject([{ tenantId: TENANT, target: 'isn', ok: false, detail: 'Invalid credentials' }]);
    });

    it('succeeds against ISN and reports whether intake is on', async () => {
        const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify({ status: 'ok', orders: [] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        const off = await call('POST', 'test', { env: KEYS });
        expect(((await off.json()) as { data: { intakeOn: boolean } }).data.intakeOn).toBe(false);
        const on = await call('POST', 'test', { env: { ...KEYS, ISN_WEBHOOK_SECRET: WEBHOOK }, tenant: 'tenant-isn-b' });
        expect(((await on.json()) as { data: { intakeOn: boolean } }).data.intakeOn).toBe(true);
        expect(fetchSpy.mock.calls[0]?.[0]).toContain('https://isn.example.test/COMPANY1/rest/orders');
        expect(saved.rows).toMatchObject([{ tenantId: TENANT, ok: true }, { tenantId: 'tenant-isn-b', ok: true }]);
    });

    it('redacts a configured credential ISN echoes, in the response and the saved history', async () => {
        vi.stubGlobal('fetch', isnReply(`Bad login for ${KEYS.ISN_ACCESS_KEY} on ${KEYS.ISN_COMPANY_KEY}`));
        const res = await call('POST', 'test', { env: { ...KEYS, ISN_WEBHOOK_SECRET: WEBHOOK } });
        const body = await res.text();
        expect(body).not.toContain(KEYS.ISN_ACCESS_KEY);
        expect(body).toContain('[redacted]');
        expect(JSON.stringify(saved.rows)).not.toContain(KEYS.ISN_ACCESS_KEY);
    });

    it('redacts a value that straddles the truncation point, leaving no fragment', async () => {
        vi.stubGlobal('fetch', isnReply(`${'x'.repeat(292)}${KEYS.ISN_SECRET_KEY} tail`));
        const res = await call('POST', 'test', { env: KEYS });
        const message = ((await res.json()) as { error: { message: string } }).error.message;
        expect(message.length).toBeLessThanOrEqual(300);
        expect(message).not.toContain('secret-');
        expect(JSON.stringify(saved.rows)).not.toContain('secret-');
    });
});

describe('GET /isn/status', () => {
    it('refuses a non-manager', async () => {
        expect((await call('GET', 'status', { role: 'inspector' })).status).toBe(403);
    });

    it.each([
        ['both', { ...KEYS, ISN_WEBHOOK_SECRET: WEBHOOK }, { keysSet: true, secretSet: true, intakeOn: true }],
        ['keys without the secret', KEYS, { keysSet: true, secretSet: false, intakeOn: false }],
        ['the secret without all keys', { ISN_COMPANY_KEY: 'C', ISN_WEBHOOK_SECRET: WEBHOOK }, { keysSet: false, secretSet: true, intakeOn: false }],
        ['nothing', {}, { keysSet: false, secretSet: false, intakeOn: false }],
    ])('reports %s', async (_n, env, expected) => {
        const res = await call('GET', 'status', { env });
        const text = await res.text();
        expect(JSON.parse(text).data).toEqual(expected);
        expect(text).not.toContain(WEBHOOK);
    });
});

describe('POST /isn/pull uses the same switch', () => {
    it('answers 503 when keys are set but the webhook secret is not', async () => {
        expect((await call('POST', 'pull', { env: KEYS })).status).toBe(503);
    });
});

describe('isn helpers', () => {
    it('isnIntakeState needs all four keys and the secret', () => {
        expect(isnIntakeState({ ...KEYS, ISN_WEBHOOK_SECRET: '  ' }).intakeOn).toBe(false);
        expect(isnIntakeState({ ...KEYS, ISN_WEBHOOK_SECRET: WEBHOOK }).intakeOn).toBe(true);
    });
    it('redactIsnSecrets replaces every configured value and ignores unset ones', () => {
        const env = { ...KEYS, ISN_WEBHOOK_SECRET: WEBHOOK };
        const out = redactIsnSecrets(`${KEYS.ISN_ACCESS_KEY}|${KEYS.ISN_SECRET_KEY}|${WEBHOOK}|${KEYS.ISN_DOMAIN}`, env);
        expect(out).toBe('[redacted]|[redacted]|[redacted]|[redacted]');
        expect(redactIsnSecrets('plain text', {})).toBe('plain text');
    });
});

describe('GET /test-results', () => {
    it('reads the history of the caller\'s tenant only', async () => {
        saved.rows.push({ tenantId: 'other', target: 'isn' });
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => { c.set('userRole', 'owner'); c.set('tenantId', TENANT); await next(); });
        app.route('/api/integrations', integrationsRoutes);
        await app.request('/api/integrations/test-results', {}, { DB: {} });
        expect(saved.listedFor).toEqual([TENANT]);
    });
});
