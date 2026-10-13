// ONB-04 — a session the API no longer honours (issued before a password change
// or reset, or its user was removed) used to load the workspace shell at 200
// with default branding: "Unnamed", openinspection.dev, no Dispatch. The layout
// loader swallowed the 401 from the session-context call as a "graceful
// fallback". It must end the session and send the visitor to /login instead.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loader } from '~/routes/auth-layout';
import { createLoadContext } from '~/lib/load-context';

const { contextGet } = vi.hoisted(() => ({ contextGet: vi.fn() }));
vi.mock('~/lib/api-client.server', () => ({
    createApi: () => ({ sessionContext: { context: { $get: contextGet } } }),
}));

// Braces matter: vitest calls a function returned from a hook as its teardown,
// and `mockReset()` returns the mock itself.
beforeEach(() => {
    contextGet.mockReset();
});

type LoaderArgs = Parameters<typeof loader>[0];

// `requireToken` reads `exp` from the payload and nothing else (the API is what
// verifies the signature), so a live session is a payload with a future `exp`.
// Same hand-rolled request as login-saas-bounce.test.ts: happy-dom drops a
// `Cookie` header set on `new Request(...)`.
const LIVE_COOKIE = `__Host-inspector_token=h.${btoa(JSON.stringify({ exp: 4102444800 }))}.s`;

function args(pathname = '/inspections'): LoaderArgs {
    const request = {
        url: `http://app.example.com${pathname}`,
        headers: { get: (name: string) => (name.toLowerCase() === 'cookie' ? LIVE_COOKIE : null) },
    };
    return { request, context: createLoadContext({}), params: {} } as unknown as LoaderArgs;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('auth layout loader — session the API refuses (ONB-04)', () => {
    it('a 401 clears the session and redirects to /login instead of rendering a default shell', async () => {
        contextGet.mockResolvedValue(json({ success: false, error: 'Token has been invalidated' }, 401));
        const thrown = await loader(args()).then(
            () => null,
            (e: unknown) => e,
        );
        expect(thrown).toBeInstanceOf(Response);
        const res = thrown as Response;
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/login');
        expect(res.headers.get('Set-Cookie')).toMatch(/__Host-inspector_token=;.*Max-Age=0/);
    });

    it('a server error keeps the defaults: the token may be fine, so the session is not ended', async () => {
        contextGet.mockResolvedValue(json({ success: false }, 500));
        const res = await loader(args());
        expect((res as { data: unknown }).data).toEqual({ context: null });
    });

    it('an unreachable API keeps the defaults too', async () => {
        contextGet.mockRejectedValue(new TypeError('fetch failed'));
        const res = await loader(args());
        expect((res as { data: unknown }).data).toEqual({ context: null });
    });

    it('a 200 hands the session context to the page', async () => {
        const ctx = { user: { locale: null }, branding: { defaultLocale: null } };
        contextGet.mockResolvedValue(json({ success: true, data: ctx }));
        const res = await loader(args());
        expect((res as { data: unknown }).data).toEqual({ context: ctx });
    });
});
