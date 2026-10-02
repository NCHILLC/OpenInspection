/**
 * The client's link into their Cost Clarity Review on Data Driven Direction, NCHI's client site
 * (fork-only; see docs/develop/fork-log.md). Null unless BOTH `DDD_SITE_URL` and
 * `DDD_LINK_SECRET` are set, so a deployment that never configured DDD shows nothing.
 *
 * The code is the inspection id and its base64url HMAC-SHA256 under `DDD_LINK_SECRET`. DDD checks
 * it on its side (src/client.ts in NCHILLC/data-driven-direction), and tests/unit/ddd/link.spec.ts
 * pins a test vector both repositories share. The link carries no name, address or email.
 */
import { base64UrlEncodeBytes } from '../lib/jwt-keyring';

export interface DddLinkEnv {
    DDD_SITE_URL?: string;
    DDD_LINK_SECRET?: string;
}

export async function dddReviewLink(env: DddLinkEnv, inspectionId: string): Promise<string | null> {
    if (!env.DDD_SITE_URL || !env.DDD_LINK_SECRET) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(env.DDD_LINK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(inspectionId)));
    return `${env.DDD_SITE_URL.replace(/\/+$/, '')}/c/${inspectionId}.${base64UrlEncodeBytes(sig)}`;
}
