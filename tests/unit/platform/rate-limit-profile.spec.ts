/**
 * The rate limiter follows the deployment profile.
 *
 * Where protection is mandatory (saas), a production request must find its
 * limiter and cannot switch it off; standalone and any loopback request keep
 * the permissive behaviour the seeded E2E suite and self-hosters rely on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Context } from 'hono';
import { checkRateLimit } from '../../../server/lib/rate-limit';
import { isDevEnvironment } from '../../../server/lib/dev-environment';

type Limiter = { limit: ReturnType<typeof vi.fn> };
const limiter = (success: boolean): Limiter => ({ limit: vi.fn(async () => ({ success })) });

function ctx(url: string, env: Record<string, unknown>): Context<never> {
    return { env, req: { url, header: () => '9.9.9.9' } } as unknown as Context<never>;
}

const PROD = 'https://app.example.com/api/x';
// The in-process BFF calls the API on a loopback URL for real visitors.
const BFF = 'http://localhost:8788/api/x';
const DEV_ENV = { ENVIRONMENT: 'development' };

afterEach(() => vi.restoreAllMocks());

describe('saas production', () => {
    it('refuses when the limiter binding is missing', async () => {
        const err = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await expect(checkRateLimit(ctx(PROD, { APP_MODE: 'saas' }) as never, 'login')).rejects.toMatchObject({ status: 503 });
        expect(err.mock.calls.map((x) => String(x[0])).join('\n')).toContain('rate_limit.binding_missing');
    });

    it('ignores DISABLE_RATE_LIMIT, enforces, and logs', async () => {
        const warn = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const l = limiter(false);
        const c = ctx(PROD, { APP_MODE: 'saas', RATE_LIMITER: l, DISABLE_RATE_LIMIT: '1' });
        await expect(checkRateLimit(c as never, 'login')).rejects.toMatchObject({ status: 429 });
        expect(l.limit).toHaveBeenCalled();
        expect(warn.mock.calls.some((c2) => String(c2[0]).includes('rate_limit.disable_flag_ignored'))).toBe(true);
    });
});

describe('saas local build (ENVIRONMENT=development)', () => {
    it('tolerates a missing binding', async () => {
        await expect(checkRateLimit(ctx(BFF, { APP_MODE: 'saas', ...DEV_ENV }) as never, 'login')).resolves.toBeUndefined();
    });

    it('honours DISABLE_RATE_LIMIT', async () => {
        const l = limiter(false);
        const c = ctx(BFF, { APP_MODE: 'saas', ...DEV_ENV, RATE_LIMITER: l, DISABLE_RATE_LIMIT: '1' });
        await expect(checkRateLimit(c as never, 'login')).resolves.toBeUndefined();
        expect(l.limit).not.toHaveBeenCalled();
    });
});

describe('standalone is unchanged', () => {
    it('production: missing binding is a no-op', async () => {
        await expect(checkRateLimit(ctx(PROD, { APP_MODE: 'standalone' }) as never, 'login')).resolves.toBeUndefined();
    });

    it('production: DISABLE_RATE_LIMIT is still honoured', async () => {
        const l = limiter(false);
        const c = ctx(PROD, { APP_MODE: 'standalone', RATE_LIMITER: l, DISABLE_RATE_LIMIT: '1' });
        await expect(checkRateLimit(c as never, 'login')).resolves.toBeUndefined();
        expect(l.limit).not.toHaveBeenCalled();
    });

    it('still enforces a binding it has', async () => {
        const c = ctx(PROD, { APP_MODE: 'standalone', RATE_LIMITER: limiter(false) });
        await expect(checkRateLimit(c as never, 'login')).rejects.toMatchObject({ status: 429 });
    });
});

describe('saas production behind the in-process BFF', () => {
    // A loopback URL says nothing: every public request reaches the API this way.
    it('still refuses a missing limiter on a loopback URL', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await expect(checkRateLimit(ctx(BFF, { APP_MODE: 'saas', ENVIRONMENT: 'production' }) as never, 'login')).rejects.toMatchObject({ status: 503 });
        await expect(checkRateLimit(ctx(BFF, { APP_MODE: 'saas' }) as never, 'login')).rejects.toMatchObject({ status: 503 });
    });

    it('still ignores DISABLE_RATE_LIMIT on a loopback URL', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const l = limiter(false);
        const c = ctx(BFF, { APP_MODE: 'saas', RATE_LIMITER: l, DISABLE_RATE_LIMIT: '1' });
        await expect(checkRateLimit(c as never, 'login')).rejects.toMatchObject({ status: 429 });
        expect(l.limit).toHaveBeenCalled();
    });
});

describe('what counts as a local build', () => {
    it('is ENVIRONMENT=development and nothing else', () => {
        expect(isDevEnvironment({ ENVIRONMENT: 'development' })).toBe(true);
        expect(isDevEnvironment({ ENVIRONMENT: 'production' })).toBe(false);
        expect(isDevEnvironment({ ENVIRONMENT: 'dev' })).toBe(false);
        expect(isDevEnvironment({ ENVIRONMENT: 'Development' })).toBe(false);
        expect(isDevEnvironment({})).toBe(false);
    });
});
