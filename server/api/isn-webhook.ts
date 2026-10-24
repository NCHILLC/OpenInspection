import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { loadTenantSecrets } from '../lib/secrets-cache';
import { applyIntegrationSecrets } from '../lib/middleware/integration-secrets';
import { IsnWebhookSchema } from '../lib/validations/isn-webhook.schema';
import { isnConfig } from '../services/isn/api-base';
import { verifyIsnSignature } from '../services/isn/webhook-signature';
import { pullIsnOrder } from '../services/isn/order-pull';

/**
 * ISN webhook: "this order changed". Authenticity is the `X-ISN-Signature` HMAC
 * keyed with the tenant's `ISN_WEBHOOK_SECRET`; the body is then used only to
 * learn WHICH order, and the order itself is re-fetched over REST.
 *
 * Tenant: the bare path relies on standalone's fixed tenant. SaaS would need a
 * `/:tenant` mount, which nobody uses yet.
 *
 * SYNCHRONOUS on purpose: one GET to ISN, well inside its 8 s timeout. A failure
 * answers 500 so ISN retries (8 attempts over about a day); work done in
 * waitUntil after a 200 would be lost for good, and there is no reconcile sweep yet.
 * No event_id ledger: the re-fetch and upsert are idempotent, so a duplicate
 * delivery just reads the order's current state again.
 */
const api = new Hono<HonoConfig>();

api.post('/', async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const header = c.req.header('x-isn-signature');
    // Copy, never mutate: c.env is shared across requests in an isolate.
    const env: Record<string, string | undefined> = { ...(c.env as unknown as Record<string, string | undefined>) };
    if (tenantId) {
        const stored = await loadTenantSecrets(c.env.DB, c.env.TENANT_CACHE, tenantId, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS)
            .catch(() => null);
        if (stored) applyIntegrationSecrets(env, stored);
    }
    const secret = env.ISN_WEBHOOK_SECRET?.trim();

    // Raw body BEFORE any parsing: the HMAC covers the exact bytes ISN sent.
    const rawBody = await c.req.text();
    if (!tenantId || !secret || !header || !(await verifyIsnSignature(secret, header, rawBody))) {
        logger.info('ISN webhook: rejected', { hasTenant: !!tenantId, hasSecret: !!secret, hasHeader: !!header });
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
