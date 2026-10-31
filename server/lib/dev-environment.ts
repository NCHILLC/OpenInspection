/**
 * Whether this worker was started as a developer's local build.
 *
 * The signal is `ENVIRONMENT` set to `development`, and nothing else. A deploy
 * ships `ENVIRONMENT=production` from the wrangler config; a developer's
 * `.dev.vars` (gitignored, never uploaded, and preferred over the config's
 * `vars` by `wrangler dev`) is the only place the override is expected to
 * live. Absent or any other value means production, so a missing or mistyped
 * setting leaves protection ON.
 *
 * The request URL is deliberately not consulted: the in-process BFF calls the
 * API on a loopback address for every real visitor, so the URL cannot tell a
 * developer from the public.
 */
export function isDevEnvironment(env: { ENVIRONMENT?: string }): boolean {
    return env.ENVIRONMENT === 'development';
}
