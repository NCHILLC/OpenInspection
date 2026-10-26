/**
 * ISN webhook signature (developer.inspectionsupport.com/webhooks/, read 2026-10-24):
 * `X-ISN-Signature: t=<unix seconds>,v1=<hex>`, where v1 is lowercase hex
 * HMAC-SHA256 of `"{t}." + raw body`, keyed with the secret STRING as-is (ISN
 * says not to hex-decode it). A retry is re-signed, so `t` is always fresh.
 */
import { bytesToHex, constantTimeEquals, hmacSha256, withinReplayWindow } from '../../lib/email/webhook-crypto';

export async function verifyIsnSignature(secret: string, header: string, rawBody: string, nowMs = Date.now()): Promise<boolean> {
    const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1 || !/^\d+$/.test(t) || !withinReplayWindow(Number(t), nowMs)) return false;
    const expected = bytesToHex(await hmacSha256(new TextEncoder().encode(secret), `${t}.${rawBody}`));
    return constantTimeEquals(expected, v1.toLowerCase());
}
