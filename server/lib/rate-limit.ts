import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { Errors } from './errors';
import { getDeploymentProfile } from './deployment-profile';
import { isLocalRequestUrl } from './local-request';
import { logger } from './logger';

/**
 * A Cloudflare rate-limit binding carries ONE fixed limit/period in its wrangler
 * config, so a route that needs a different ceiling than the 10/60s default names
 * its own binding here. An absent binding is a no-op, like the default one.
 */
export type RateLimiterName = 'RATE_LIMITER' | 'QBO_WEBHOOK_RATE_LIMITER' | 'STRIPE_WEBHOOK_RATE_LIMITER';

/**
 * Check the Cloudflare Rate Limiter for the given prefix + CF-Connecting-IP key.
 * No-ops when the binding is absent (local dev).
 * Throws RateLimited if the limit is exceeded.
 * `scope` replaces the client IP in the key (e.g. a tenant id) so a limit can be
 * shared by everyone acting for one workspace.
 */
export async function checkRateLimit(
    c: Context<HonoConfig>, prefix: string, scope?: string, limiter: RateLimiterName = 'RATE_LIMITER',
): Promise<void> {
    // Named reads, not `c.env[limiter]`: a computed key hides the property from
    // the unread-field gate and from anyone grepping for who uses a binding.
    const binding = limiter === 'QBO_WEBHOOK_RATE_LIMITER' ? c.env.QBO_WEBHOOK_RATE_LIMITER
        : limiter === 'STRIPE_WEBHOOK_RATE_LIMITER' ? c.env.STRIPE_WEBHOOK_RATE_LIMITER
        : c.env.RATE_LIMITER;
    // Where protection is mandatory (saas) a deployment off a developer's
    // machine must have its limiter: an absent binding is a misconfiguration
    // that would otherwise leave every limited route unlimited without a sign.
    // Standalone keeps the no-op, as does any loopback request.
    const guarded = getDeploymentProfile(c.env).botProtectionMandatory && !isLocalRequestUrl(c.req.url);
    if (!binding) {
        if (!guarded) return;
        logger.error('rate_limit.binding_missing', { limiter });
        throw Errors.ServiceUnavailable('Rate limiting is not configured.');
    }
    // Test/dev escape hatch (defaults to enforced): the seeded E2E suite drives
    // ~140 specs' logins from a single runner IP, which blows past the 10/60s
    // login limiter and 429s beforeAll hooks flakily. Only the ephemeral E2E
    // .dev.vars sets this. Where protection is mandatory it is honoured on a
    // loopback request only; a production request ignores it and says so.
    if (c.env.DISABLE_RATE_LIMIT === '1') {
        if (!guarded) return;
        logger.warn('rate_limit.disable_flag_ignored', { limiter });
    }
    const who = scope ?? c.req.header('CF-Connecting-IP') ?? 'unknown';
    const { success } = await binding.limit({ key: `${prefix}:${who}` });
    if (!success) throw Errors.RateLimited();
}
