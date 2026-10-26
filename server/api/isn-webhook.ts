import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { IsnWebhookSchema } from '../lib/validations/isn-webhook.schema';
import { isnConfig, isnTenantEnv } from '../services/isn/api-base';
import { verifyIsnSignature } from '../services/isn/webhook-signature';
import { constantTimeEquals } from '../lib/email/webhook-crypto';
import { pullIsnOrder } from '../services/isn/order-pull';

/**
 * ISN webhook: "this order changed". Authenticity is the `X-ISN-Signature` HMAC
 * keyed with the tenant's `ISN_WEBHOOK_SECRET`, or for an unsigned webhook that
 * same secret as the URL's `?key=`; the body is then used only to
 * learn WHICH order, and the order itself is re-fetched over REST.
 *
 * Tenant: the bare path relies on standalone's fixed tenant. SaaS would need a
 * `/:tenant` mount, which nobody uses yet.
 *
 * SYNCHRONOUS on purpose: one GET to ISN, well inside its 8 s timeout. A failure
 * answers 500 so ISN retries (8 attempts over about a day); work done in
 * waitUntil after a 200 would never be retried by ISN; the hourly reconcile
 * (`isnOrderReconcileJob`) heals only today-forward orders.
 * No event_id ledger: the re-fetch and upsert are idempotent, so a duplicate
 * delivery just reads the order's current state again.
 */
const api = new Hono<HonoConfig>();

api.post('/', async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const header = c.req.header('x-isn-signature');
    const key = c.req.query('key');
    const env = tenantId ? await isnTenantEnv(c.env, tenantId) : {};
    const secret = env.ISN_WEBHOOK_SECRET?.trim();

    // Raw body BEFORE any parsing: the HMAC covers the exact bytes ISN sent.
    const rawBody = await c.req.text();
    // Offices on older ISN can only make unsigned webhooks (no "Add signing secret", no
    // REST /webhooks), so the secret may ride in the URL as `?key=` instead. A sent
    // signature still has to verify.
    const authentic = !!secret && (header
        ? await verifyIsnSignature(secret, header, rawBody)
        : !!key && constantTimeEquals(key, secret));
    if (!tenantId || !authentic) {
        logger.info('ISN webhook: rejected', { hasTenant: !!tenantId, hasSecret: !!secret, hasHeader: !!header, hasKey: !!key });
        return c.json({ success: false, error: { message: 'Invalid signature' } }, 401);
    }

    let json: unknown;
    try { json = JSON.parse(rawBody); } catch { json = null; }
    const parsed = IsnWebhookSchema.safeParse(json);
    if (!parsed.success) {
        logger.warn('ISN webhook: body is not the expected JSON', { contentType: c.req.header('content-type') });
        return c.json({ success: false, error: { message: 'Invalid body' } }, 400);
    }
    const evt = parsed.data;
    const orderRef = evt.order_id ?? (evt.order_oid !== undefined ? String(evt.order_oid) : undefined);
    if (evt.test || !orderRef) {
        logger.info('ISN webhook: acknowledged, nothing to apply', { action: evt.action, test: !!evt.test, eventId: evt.event_id });
        return c.json({ success: true });
    }

    const cfg = isnConfig(env);
    if (!cfg) {
        logger.warn('ISN webhook: signed event but ISN REST keys are not set', { action: evt.action });
        return c.json({ success: false, error: { message: 'ISN keys not configured' } }, 500);
    }
    try {
        const isnOrderId = await pullIsnOrder(c.env.DB, tenantId, cfg, orderRef);
        logger.info('ISN webhook: order refreshed', { action: evt.action, eventId: evt.event_id, isnOrderId });
        return c.json({ success: true });
    } catch (e) {
        logger.error('ISN webhook: order re-fetch failed', { action: evt.action, eventId: evt.event_id }, e instanceof Error ? e : undefined);
        return c.json({ success: false, error: { message: 'Processing failed' } }, 500);
    }
});

export default api;
