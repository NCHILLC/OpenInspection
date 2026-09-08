/**
 * The set of request paths the MCP/OAuth surface owns.
 *
 * THIS MODULE MUST STAY DEPENDENCY-FREE. It is imported at the top level of
 * `workers/app.ts`, whose whole job is to keep the eager module graph small —
 * see the lazy-load note there. Constants and one pure predicate only.
 *
 * It exists so the worker entry's lazy-load GATE and the OAuthProvider's own
 * CONFIGURATION cannot drift apart. Both read these values: `buildOAuthHandler`
 * passes them to OAuthProvider, and the entry uses `isMcpSurfacePath` to decide
 * whether a request is worth loading that provider for. A comment saying "keep
 * these in sync" would be a latent bug — an endpoint added to the provider but
 * missed by the gate would 404 for MCP clients only, and silently.
 */

/** Endpoints `buildOAuthHandler` mounts explicitly on the OAuthProvider. */
export const OAUTH_AUTHORIZE_ENDPOINT = '/oauth/authorize';
export const OAUTH_TOKEN_ENDPOINT = '/oauth/token';
export const OAUTH_REGISTER_ENDPOINT = '/oauth/register';

/**
 * Discovery endpoints `@cloudflare/workers-oauth-provider` serves ITSELF, without
 * being configured to: `/.well-known/oauth-authorization-server` and
 * `/.well-known/oauth-protected-resource`. They are matched by prefix because
 * they belong to the library, not to us — a future version adding a third
 * `oauth-*` document must not start 404ing.
 */
const OAUTH_DISCOVERY_PREFIX = '/.well-known/oauth';

/**
 * True when `pathname` belongs to the MCP/OAuth surface and the request
 * therefore needs the (heavy, lazily loaded) provider graph.
 *
 * `apiRoute` is `profile.mcpApiRoute`, '/mcp' in both modes; SaaS serves its
 * per-workspace endpoints beneath it as /mcp/{slug}. Both the route itself and
 * anything beneath it count — OAuthProvider treats the whole subtree as its
 * API surface.
 */
export function isMcpSurfacePath(pathname: string, apiRoute: string): boolean {
    const subtree = apiRoute.endsWith('/') ? apiRoute : `${apiRoute}/`;
    if (pathname === apiRoute || pathname.startsWith(subtree)) return true;
    return (
        pathname === OAUTH_AUTHORIZE_ENDPOINT ||
        pathname === OAUTH_TOKEN_ENDPOINT ||
        pathname === OAUTH_REGISTER_ENDPOINT ||
        pathname.startsWith(OAUTH_DISCOVERY_PREFIX)
    );
}
