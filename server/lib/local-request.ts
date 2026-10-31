/**
 * Whether a request was addressed to this machine's loopback interface.
 *
 * The one signal the worker has for "this is a developer's machine": the build
 * ships the same `ENVIRONMENT` value to `wrangler dev` as to a deploy, so a
 * variable cannot tell them apart, but a production request never arrives at a
 * loopback host. Exact names only; a prefix test would match real domains that
 * merely start with `localhost`.
 */
function isLocalHostname(hostname: string): boolean {
    const name = hostname.toLowerCase();
    return name === 'localhost' || name.endsWith('.localhost') || name === '127.0.0.1' || name === '[::1]';
}

/** `isLocalHostname` for a request URL; an unparseable URL is not local. */
export function isLocalRequestUrl(url: string): boolean {
    try {
        return isLocalHostname(new URL(url).hostname);
    } catch {
        return false;
    }
}
