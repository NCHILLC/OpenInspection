/**
 * Design System 0520 subsystem E phase 6 — IntegrationsService routes.
 *
 * `GET /api/integrations/status` returns the six-row snapshot the
 * grid page renders. JWT-guarded; tenant scope from the JWT claim.
 *
 * `POST /api/integrations/stripe/test` — on-demand "Test connection" diagnostic.
 * `GET  /api/integrations/stripe/webhook-log` — recent delivery log (diagnostics).
 * `POST /api/integrations/email/validate` — validate stored BYO email provider creds.
 * `/api/integrations/isn/{test,status,pull}` — ISN Test connection, intake state, Pull now.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { requireRole } from '../lib/middleware/rbac';
import { EmailValidateBodySchema, EmailValidateOkSchema, IsnPullBodySchema, IsnIntakeStatusSchema } from '../lib/validations/integrations.schema';
import { resolveEmailProvider } from '../lib/email/resolve-provider';
import { logger } from '../lib/logger';
import { recordIntegrationTest, listIntegrationTestResults, type IntegrationTarget } from '../lib/integration-test-results';
import { getDrizzle, createDrizzle } from '../lib/route-helpers';

/**
 * Single write point for the four "Test connection" probes in this file — keeps
 * the insert+prune logic out of every handler. Best-effort: a logging failure
 * must never change the probe's own HTTP response.
 */
async function logTest(
    env: { DB: D1Database },
    tenantId: string | undefined,
    testedByUserId: string | null,
    target: IntegrationTarget,
    ok: boolean,
    detail: string | null,
    provider?: string | null,
): Promise<void> {
    if (!tenantId) return;
    await recordIntegrationTest(createDrizzle(env.DB), {
        tenantId, target, ok, detail, provider: provider ?? null, testedByUserId,
    }).catch(() => {});
}

const statusRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/status',
    tags: ['integrations'],
    summary: 'Snapshot of every integration for the active tenant',
    responses: { 200: { description: 'ok' } },
    operationId: 'listIntegrationStatus',
    description: 'Returns a per-integration enabled/configured status row for the active tenant. Drives the integrations overview grid on the settings page.',
}, { scopes: ['read'], tier: 'extended' }));

// ─── POST /stripe/test ────────────────────────────────────────────────────────

const StripeTestResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        accountName: z.string().describe('Display name (or email/id fallback) of the connected Stripe account.'),
        livemode: z.boolean().describe('True when the stored key is a live-mode key (sk_live_/rk_live_ prefix).'),
    }),
}).openapi('StripeTestResponse');

const stripeTestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/stripe/test',
    tags: ['integrations'],
    summary: 'Verify the stored Stripe secret key against the live API',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: StripeTestResponseSchema } }, description: 'Key is valid; returns account name and mode' },
        502: { description: 'Stripe rejected the stored key' },
        503: { description: 'No Stripe secret key configured' },
    },
    operationId: 'testStripeConnection',
    description: "Calls Stripe GET /v1/account with the tenant's STORED secret key (merged into env by the integration-secrets middleware) — the on-demand diagnostic behind the settings-page Test connection button. Mode (test/live) is inferred from the key prefix.",
}, { scopes: ['admin'], tier: 'extended' }));

// ─── GET /stripe/webhook-log ──────────────────────────────────────────────────

const WebhookLogEntrySchema = z.object({
    ts: z.string().describe('ISO 8601 delivery timestamp.'),
    eventType: z.string().describe('Stripe event type, or "unknown" for unverifiable payloads.'),
    result: z.enum(['processed', 'received', 'signature_failed', 'tenant_mismatch']).describe('Delivery outcome.'),
});

const stripeWebhookLogRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/stripe/webhook-log',
    tags: ['integrations'],
    summary: 'Recent Stripe webhook deliveries (diagnostics)',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(WebhookLogEntrySchema) }).openapi('StripeWebhookLogResponse') } }, description: 'Up to 20 recent deliveries, newest first' },
    },
    operationId: 'getStripeWebhookLog',
    description: 'Reads the per-tenant KV rolling log written by the Stripe webhook handler. Metadata only (timestamp, event type, result) — payloads are never stored. Backs the settings-page Recent Deliveries panel.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── POST /resend/test + /ai/test + PUT /ai/config ─────────────────────────────────────────

const resendTestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/resend/test',
    tags: ['integrations'],
    summary: 'Verify the stored Resend API key against the live API',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ domains: z.number().describe('Verified sending domains on the account.') }) }).openapi('ResendTestResponse') } }, description: 'Key is valid' },
        502: { description: 'Resend rejected the stored key' },
        503: { description: 'No Resend API key configured' },
    },
    operationId: 'testResendConnection',
    description: "Calls Resend GET /domains with the tenant's STORED API key (merged into env by the integration-secrets middleware) — the on-demand diagnostic behind the Communication settings Test connection button.",
}, { scopes: ['admin'], tier: 'extended' }));

// ─── POST /email/validate ─────────────────────────────────────────────────────

const emailValidateRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/email/validate',
    tags: ['integrations'],
    summary: 'Validate stored BYO email provider credentials',
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: { content: { 'application/json': { schema: EmailValidateBodySchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: EmailValidateOkSchema } }, description: 'Credentials accepted by the provider' },
        502: { description: 'Provider rejected the stored credentials' },
        503: { description: 'Required credentials not configured' },
    },
    operationId: 'validateEmailProviderCredentials',
    description: [
        "Validates the tenant's stored BYO email provider credentials by calling each",
        'provider\'s validateCredentials() method. Use for sendgrid / postmark / mailgun;',
        'Resend keeps its own /resend/test endpoint (send-only key probe). Creds are',
        'read from c.env after integration-secrets middleware merges them from the',
        'encrypted tenant store.',
    ].join(' '),
}, { scopes: ['admin'], tier: 'extended' }));

// ─── GET /test-results ────────────────────────────────────────────────────────

const TestResultSchema = z.object({
    target: z.enum(['sms', 'email', 'stripe', 'gemini', 'isn']).describe('Which integration was probed.'),
    provider: z.string().nullable().describe('Provider variant within the target (e.g. twilio/resend); null for single-provider targets.'),
    ok: z.boolean().describe('Whether the probe succeeded.'),
    detail: z.string().nullable().describe('Non-sensitive outcome summary or provider error message.'),
    testedByUserId: z.string().nullable().describe('JWT sub of the user who ran the probe.'),
    testedAt: z.number().describe('Epoch milliseconds when the probe ran.'),
}).openapi('IntegrationTestResult');

const testResultsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/test-results',
    tags: ['integrations'],
    summary: 'Recent "Test connection" outcomes for every integration',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(TestResultSchema) }).openapi('IntegrationTestResultsResponse') } }, description: 'Up to 5 recent results per integration, newest first' },
    },
    operationId: 'listIntegrationTestResults',
    description: 'Returns the retained "Test connection" history for the active tenant (≤5 per integration, newest first). Backs the persisted "Last tested …" status shown next to each Test connection button.',
}, { scopes: ['read'], tier: 'extended' }));

// ─── POST /isn/pull ───────────────────────────────────────────────────────────

const isnPullRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/isn/pull',
    tags: ['integrations'],
    summary: 'Pull ISN orders now',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: IsnPullBodySchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({
            processed: z.number().describe('Orders pulled from ISN and applied in this batch.'),
            failed: z.number().describe('Orders that were due in this batch but could not be pulled; the next pass tries them again.'),
            nextCursor: z.string().nullable().describe('Pass back to pull the next batch; null when every due order is done.'),
        }) }) } }, description: 'One batch pulled' },
        503: { description: 'ISN keys or ISN_WEBHOOK_SECRET not set: ISN intake is off' },
    },
    operationId: 'pullIsnOrders',
    description: "Runs one batch (5 orders) of the hourly ISN reconcile on demand: lists ISN's orders from yesterday forward and pulls every one OI is missing or holds an older copy of, creating or updating its inspection. Needs the ISN keys AND ISN_WEBHOOK_SECRET, the switch that turns ISN intake on (keys alone only send report links). Call again with `nextCursor` until it is null.",
}, { scopes: ['admin'], tier: 'extended' }));

// ─── POST /isn/test ───────────────────────────────────────────────────────────

const isnTestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/isn/test',
    tags: ['integrations'],
    summary: 'Verify the stored ISN keys against ISN',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({
            intakeOn: z.boolean().describe('True when ISN_WEBHOOK_SECRET is also set, which is what turns ISN intake on.'),
        }) }) } }, description: 'ISN accepted the stored keys' },
        502: { description: "ISN rejected the call; the error message is ISN's own" },
        503: { description: 'The ISN keys are not all set' },
    },
    operationId: 'testIsnConnection',
    description: "Makes one read-only call to ISN (the order list for today) with the tenant's STORED ISN keys, the diagnostic behind the settings-page Test connection button. On failure the error message is the one ISN returned.",
}, { scopes: ['admin'], tier: 'extended' }));

const isnStatusRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/isn/status',
    tags: ['integrations'],
    summary: 'Whether ISN intake is on, from the keys and secret in effect',
    middleware: [requireRole('owner', 'manager')],
    responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: IsnIntakeStatusSchema }) } }, description: 'ISN intake status' } },
    operationId: 'getIsnStatus',
    description: 'Reports, from the same merged deployment and stored values the cron and Pull now use, whether the four ISN keys are set, whether ISN_WEBHOOK_SECRET is set, and whether intake is therefore on (both). Never returns a secret value.',
}, { scopes: ['admin'], tier: 'extended' }));

// ─── Router ───────────────────────────────────────────────────────────────────

const integrationsRoutes = createApiRouter()
    .openapi(isnStatusRoute, async (c) => {
        const { isnIntakeState } = await import('../services/isn/api-base');
        return c.json({ success: true as const, data: isnIntakeState(c.env) }, 200);
    })
    .openapi(isnTestRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const uid = c.get('user')?.sub ?? null;
        const { isnConfig, isnCall, IsnError, isnIntakeState } = await import('../services/isn/api-base');
        const cfg = isnConfig(c.env);
        if (!cfg) {
            const message = 'The ISN keys are not all set.';
            await logTest(c.env, tenantId, uid, 'isn', false, message);
            return c.json({ success: false as const, error: { code: 'ISN_NOT_CONFIGURED', message } }, 503);
        }
        try {
            await isnCall(cfg, 'GET', '/orders', { datetimeafter: new Date().toISOString().slice(0, 10) });
        } catch (e) {
            // ISN answers 200 to errors; its own message is the signal (isnCall already removed any credential it echoes).
            const message = (e instanceof IsnError ? e.isnMessage : 'Could not reach ISN.').slice(0, 300);
            await logTest(c.env, tenantId, uid, 'isn', false, message);
            return c.json({ success: false as const, error: { code: 'ISN_REJECTED', message } }, 502);
        }
        const { intakeOn } = isnIntakeState(c.env);
        await logTest(c.env, tenantId, uid, 'isn', true, intakeOn ? 'Connected to ISN. ISN intake is on.' : 'Connected to ISN. ISN intake is off: ISN_WEBHOOK_SECRET is not set.');
        return c.json({ success: true as const, data: { intakeOn } }, 200);
    })
    .openapi(isnPullRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const { isnConfig, isnIntakeState } = await import('../services/isn/api-base');
        const cfg = isnConfig(c.env);
        // Same switch as the cron (cron/jobs/integrations.ts): keys alone must not create inspections.
        if (!cfg || !isnIntakeState(c.env).intakeOn) throw Errors.ServiceUnavailable('ISN intake is off: set the ISN keys and ISN_WEBHOOK_SECRET first');
        const { reconcileIsnOrders } = await import('../services/isn/order-reconcile');
        const data = await reconcileIsnOrders(c.env.DB, tenantId, cfg, c.req.valid('json').cursor ?? null, 5);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(statusRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const out = await c.var.services.integrations.status(tenantId);
        return c.json({ success: true as const, data: out }, 200);
    })
    .openapi(testResultsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const data = await listIntegrationTestResults(getDrizzle(c), tenantId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(stripeTestRoute, async (c) => {
        const env = c.env;
        const tenantId = c.get('tenantId');
        const uid = c.get('user')?.sub ?? null;
        const secretKey = env.STRIPE_SECRET_KEY;
        if (!secretKey) {
            await logTest(c.env, tenantId, uid, 'stripe', false, 'No Stripe secret key is configured.');
            return c.json({ success: false as const, error: { code: 'STRIPE_NOT_CONFIGURED', message: 'No Stripe secret key is configured.' } }, 503);
        }
        try {
            const { StripeService } = await import('../services/stripe.service');
            const { accountName } = await new StripeService(secretKey).getAccount();
            const livemode = secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_');
            await logTest(c.env, tenantId, uid, 'stripe', true, `Connected to ${accountName}${livemode ? ' (live mode)' : ' (test mode)'}.`);
            return c.json({ success: true as const, data: { accountName, livemode } }, 200);
        } catch {
            await logTest(c.env, tenantId, uid, 'stripe', false, 'Stripe rejected the stored secret key.');
            return c.json({ success: false as const, error: { code: 'STRIPE_KEY_INVALID', message: 'Stripe rejected the stored secret key.' } }, 502);
        }
    })
    .openapi(stripeWebhookLogRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const { readWebhookLog } = await import('../lib/stripe-webhook-log');
        const entries = await readWebhookLog(c.env.TENANT_CACHE, tenantId);
        return c.json({ success: true as const, data: entries }, 200);
    })
    .openapi(resendTestRoute, async (c) => {
        const env = c.env;
        const tenantId = c.get('tenantId');
        const uid = c.get('user')?.sub ?? null;
        const key = env.RESEND_API_KEY;
        if (!key) {
            await logTest(c.env, tenantId, uid, 'email', false, 'No Resend API key is configured.', 'resend');
            return c.json({ success: false as const, error: { code: 'RESEND_NOT_CONFIGURED', message: 'No Resend API key is configured.' } }, 503);
        }
        // Auth-only probe via the Resend provider — no hand-rolled vendor URL.
        const { ResendProvider } = await import('../lib/email/providers/resend');
        const provider = new ResendProvider({ apiKey: key });
        const probe = await provider.probeApiKey();
        if (!probe.valid) {
            await logTest(c.env, tenantId, uid, 'email', false, 'Resend rejected the stored API key.', 'resend');
            return c.json({ success: false as const, error: { code: 'RESEND_KEY_INVALID', message: 'Resend rejected the stored API key.' } }, 502);
        }
        const domains = await provider.countVerifiedDomains();
        await logTest(c.env, tenantId, uid, 'email', true, `Resend key valid${domains > 0 ? ` · ${domains} verified domain${domains === 1 ? '' : 's'}` : ''}.`, 'resend');
        return c.json({ success: true as const, data: { domains } }, 200);
    })
    .openapi(emailValidateRoute, async (c) => {
        const { provider } = c.req.valid('json');
        const env = c.env;
        const tenantId = c.get('tenantId');
        const uid = c.get('user')?.sub ?? null;

        // Build creds from env (integration-secrets middleware merges the tenant's
        // stored keys into env before this handler runs — same path as resendTestRoute).
        let creds: { apiKey: string } | { apiKey: string; domain: string } | null = null;

        switch (provider) {
            case 'resend': {
                const key = env.RESEND_API_KEY;
                if (!key) {
                    await logTest(c.env, tenantId, uid, 'email', false, 'No Resend API key is configured.', provider);
                    return c.json({ success: false as const, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'No Resend API key is configured.' } }, 503);
                }
                creds = { apiKey: key };
                break;
            }
            case 'sendgrid': {
                const key = env.SENDGRID_API_KEY;
                if (!key) {
                    await logTest(c.env, tenantId, uid, 'email', false, 'No SendGrid API key is configured.', provider);
                    return c.json({ success: false as const, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'No SendGrid API key is configured.' } }, 503);
                }
                creds = { apiKey: key };
                break;
            }
            case 'postmark': {
                const token = env.POSTMARK_SERVER_TOKEN;
                if (!token) {
                    await logTest(c.env, tenantId, uid, 'email', false, 'No Postmark Server Token is configured.', provider);
                    return c.json({ success: false as const, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'No Postmark Server Token is configured.' } }, 503);
                }
                creds = { apiKey: token };
                break;
            }
            case 'mailgun': {
                const key = env.MAILGUN_API_KEY;
                const domain = env.MAILGUN_DOMAIN;
                if (!key || !domain) {
                    await logTest(c.env, tenantId, uid, 'email', false, 'Mailgun API key and domain are both required.', provider);
                    return c.json({ success: false as const, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Mailgun API key and domain are both required.' } }, 503);
                }
                creds = { apiKey: key, domain };
                break;
            }
        }

        try {
            const adapter = resolveEmailProvider(provider, creds);
            const result = adapter.validateCredentials
                ? await adapter.validateCredentials()
                : { ok: true as const };

            if (result.ok) {
                await logTest(c.env, tenantId, uid, 'email', true, `${provider} credentials valid.`, provider);
                return c.json({ success: true as const, data: { ok: true as const } }, 200);
            }
            await logTest(c.env, tenantId, uid, 'email', false, (result as { ok: false; error: string }).error, provider);
            return c.json({
                success: false as const,
                error: { code: 'EMAIL_KEY_INVALID', message: (result as { ok: false; error: string }).error },
            }, 502);
        } catch (err) {
            // Never 500 — surface as 502 with a safe message; do NOT log the key.
            logger.warn('[email-validate] unexpected error during credential check', {
                tenantId,
                provider,
                error: err instanceof Error ? err.message : String(err),
            });
            await logTest(c.env, tenantId, uid, 'email', false, 'Credential validation failed unexpectedly.', provider);
            return c.json({
                success: false as const,
                error: { code: 'EMAIL_KEY_INVALID', message: 'Credential validation failed unexpectedly.' },
            }, 502);
        }
    });

export type IntegrationsApi = typeof integrationsRoutes;
export default integrationsRoutes;
