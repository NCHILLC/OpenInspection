/**
 * ISN webhook receiver. Signature format from developer.inspectionsupport.com/webhooks/
 * (read 2026-10-24): `t=<unix s>,v1=<hex HMAC-SHA256("{t}." + raw body)>`, keyed with
 * the secret string itself.
 */
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyIsnSignature } from '../../../server/services/isn/webhook-signature';

const pull = vi.fn(async () => 'order-uuid');
vi.mock('../../../server/services/isn/order-pull', () => ({ pullIsnOrder: pull }));
vi.mock('../../../server/lib/secrets-cache', () => ({ loadTenantSecrets: async () => null }));
const { default: isnWebhookRoutes } = await import('../../../server/api/isn-webhook');

const SECRET = 'a'.repeat(64);
const ISN_KEYS = { ISN_DOMAIN: 'https://inspectionsupport.com', ISN_COMPANY_KEY: 'co', ISN_ACCESS_KEY: 'isn-access-7Qm2xKd', ISN_SECRET_KEY: 'isn-secret-9Zp4vLc' };

function sign(body: string, t = Math.floor(Date.now() / 1000), secret = SECRET) {
    return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

function send(body: string, headers: Record<string, string>, env: Record<string, string | undefined> = { ISN_WEBHOOK_SECRET: SECRET, ...ISN_KEYS }, tenantId: string | undefined = 't1', query = '') {
    const app = new Hono();
    app.use('*', async (c, next) => { if (tenantId) c.set('tenantId' as never, tenantId as never); await next(); });
    app.route('/webhooks/isn', isnWebhookRoutes as unknown as Hono);
    return app.request(`/webhooks/isn${query}`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } }, { DB: {}, ...env });
}

afterEach(() => pull.mockClear());

describe('verifyIsnSignature', () => {
    const body = '{"event_id":"e1"}';
    it('accepts a good signature, case-insensitively on v1', async () => {
        expect(await verifyIsnSignature(SECRET, sign(body), body)).toBe(true);
        expect(await verifyIsnSignature(SECRET, sign(body).toUpperCase().replace('T=', 't=').replace('V1=', 'v1='), body)).toBe(true);
    });
    it('rejects a tampered body, a wrong secret, a stale t and a malformed header', async () => {
        expect(await verifyIsnSignature(SECRET, sign(body), body + ' ')).toBe(false);
        expect(await verifyIsnSignature(SECRET, sign(body, undefined, 'b'.repeat(64)), body)).toBe(false);
        expect(await verifyIsnSignature(SECRET, sign(body, Math.floor(Date.now() / 1000) - 301), body)).toBe(false);
        expect(await verifyIsnSignature(SECRET, 'v1=abc', body)).toBe(false);
        expect(await verifyIsnSignature(SECRET, '', body)).toBe(false);
    });
    it('keys with the secret string, not its hex-decoded bytes', async () => {
        const t = Math.floor(Date.now() / 1000);
        const hexDecoded = createHmac('sha256', Buffer.from(SECRET, 'hex')).update(`${t}.${body}`).digest('hex');
        expect(await verifyIsnSignature(SECRET, `t=${t},v1=${hexDecoded}`, body)).toBe(false);
    });
});

describe('POST /webhooks/isn', () => {
    const body = JSON.stringify({ event_id: 'e1', action: 'ORDER_UPDATED', order_id: 'order-uuid', order_oid: 146 });

    it('re-fetches the order named by a signed event', async () => {
        const res = await send(body, { 'x-isn-signature': sign(body) });
        expect(res.status).toBe(200);
        expect(pull).toHaveBeenCalledWith({}, 't1', expect.objectContaining({ companyKey: 'co' }), 'order-uuid');
    });

    it('answers 401, never 500, while the secret is unset', async () => {
        const res = await send(body, { 'x-isn-signature': sign(body) }, { ...ISN_KEYS });
        expect(res.status).toBe(401);
        expect(pull).not.toHaveBeenCalled();
    });

    it('answers 401 to a missing or bad signature, and with no tenant', async () => {
        expect((await send(body, {})).status).toBe(401);
        expect((await send(body, { 'x-isn-signature': sign('{}') })).status).toBe(401);
        expect((await send(body, { 'x-isn-signature': sign(body) }, undefined, '')).status).toBe(401);
        expect(pull).not.toHaveBeenCalled();
    });

    it('accepts an unsigned event whose URL carries the secret as ?key=', async () => {
        const res = await send(body, {}, undefined, 't1', `?key=${SECRET}`);
        expect(res.status).toBe(200);
        expect(pull).toHaveBeenCalledWith({}, 't1', expect.anything(), 'order-uuid');
    });

    it('answers 401 to a wrong ?key=, an unset secret, and a bad signature beside a good key', async () => {
        expect((await send(body, {}, undefined, 't1', `?key=${'b'.repeat(64)}`)).status).toBe(401);
        expect((await send(body, {}, { ...ISN_KEYS }, 't1', '?key=')).status).toBe(401);
        expect((await send(body, { 'x-isn-signature': sign('{}') }, undefined, 't1', `?key=${SECRET}`)).status).toBe(401);
        expect(pull).not.toHaveBeenCalled();
    });

    it('acknowledges a test event without applying it', async () => {
        const test = JSON.stringify({ event_id: 'e2', action: 'ORDER_UPDATED', order_id: 'order-uuid', test: true });
        const res = await send(test, { 'x-isn-signature': sign(test) });
        expect(res.status).toBe(200);
        expect(pull).not.toHaveBeenCalled();
    });

    it('falls back to the numeric order number when there is no uuid', async () => {
        const oidOnly = JSON.stringify({ event_id: 'e3', action: 'ORDER_CREATED', order_oid: 146 });
        await send(oidOnly, { 'x-isn-signature': sign(oidOnly) });
        expect(pull).toHaveBeenCalledWith({}, 't1', expect.anything(), '146');
    });

    it('answers 500 when the re-fetch fails, so ISN retries', async () => {
        pull.mockRejectedValueOnce(new Error('ISN down'));
        expect((await send(body, { 'x-isn-signature': sign(body) })).status).toBe(500);
    });

    it('answers 400 to a signed body that is not JSON', async () => {
        const form = 'order_id=x';
        expect((await send(form, { 'x-isn-signature': sign(form) })).status).toBe(400);
    });
});
