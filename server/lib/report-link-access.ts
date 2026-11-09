/**
 * Who may read a report's media over a report link, in one place.
 *
 * The report data, the report photo and the report video routes all answer the same question: does this request hold a
 * proof for THIS inspection (portal token, legacy share token, render token, or the owner's session), and is the report
 * released to that kind of reader. Three copies of that answer is how one of them drifts, so the photo route and the
 * video routes both call `authorizeReportMedia`.
 */
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { inspections } from './db/schema';
import { resolvePortalAccess, resolveOwnerPreview } from './public-access';
import { resolveRenderAccess } from './render-token';
import { publicReportAccessAllowed } from './report-access';
import { getDrizzle } from './route-helpers';

/**
 * The outstanding release gate for a public request, or null when nothing holds
 * the report back.
 *
 * Skipped entirely on the bypass paths rather than computed and discarded: the
 * predicate ignores it there, and asking anyway would put two database reads on
 * every page the headless PDF renderer loads.
 *
 * Takes the service structurally so this module needs no new import, and so a
 * test can hand it a stub without constructing the whole service graph.
 */
export async function releaseGateFor(
    services: { inspection: { resolveReleaseGate(inspectionId: string, tenantId: string): Promise<{ reason: 'payment' | 'agreement' } | null> } },
    id: string,
    tenantId: string,
    bypass: boolean,
): Promise<'payment' | 'agreement' | null> {
    if (bypass) return null;
    const gate = await services.inspection.resolveReleaseGate(id, tenantId);
    return gate?.reason ?? null;
}

/**
 * Shared client-facing tenant resolution for the public report endpoints:
 * the persistent per-(recipient, order) portal token, falling back to the
 * legacy KV agent-view-token bridge (`?view=agent&token=`). Returns the
 * AUTHORITATIVE tenantId from whichever token resolves to THIS inspection, or
 * null. Identical across the report-data, report-photo, report-video and report-PDF routes.
 * `accessTokenId` is the per-recipient token row's id, or null on the legacy
 * KV bridge (no row) — so a bridge view is never counted, which is right: it
 * names no recipient. It is the identity delivery confirmation counts against.
 */
export async function resolveClientTenant(
    c: Context<HonoConfig>, token: string | undefined, id: string,
): Promise<{ tenantId: string; accessTokenId: string | null } | null> {
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, id);
    if (grant) return { tenantId: grant.tenantId, accessTokenId: grant.accessTokenId };
    if (!token) return null;
    // Bridge: existing customer share links carry the KV agent-view-token until
    // persistent per-recipient token issuance is wired (see plan
    // 2026-06-01-core-esign-redesign). Validate it the same way: token must
    // resolve to THIS inspection; tenantId from the token.
    const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
    if (legacy && legacy.inspectionId === id) return { tenantId: legacy.tenantId, accessTokenId: null };
    return null;
}

/**
 * The company a report-media request is entitled to, or null (answer 404).
 *
 * Order of proofs: client token, then the server-minted render token, then the owner's session cookie. The report must
 * also be published and not held back by an unsigned agreement or an unpaid invoice; the renderer and the owner pass the
 * hold, because the renderer is how a held report gets built and the owner is its author.
 */
export async function authorizeReportMedia(
    c: Context<HonoConfig>, id: string, proof: { token?: string | undefined; render?: string | undefined },
): Promise<{ tenantId: string } | null> {
    let tenantId = (await resolveClientTenant(c, proof.token, id))?.tenantId ?? null;
    let renderMode = false;
    let ownerPreview = false;
    if (!tenantId && proof.render) {
        const r = await resolveRenderAccess(proof.render, id, c.env.JWT_SECRET);
        if (r) {
            const row = await getDrizzle(c).select({ tenantId: inspections.tenantId })
                .from(inspections).where(eq(inspections.id, id)).get();
            if (row) { tenantId = row.tenantId; renderMode = true; }
        }
    }
    // Owner-session preview: the owner's tokenless preview loads its media too. Callers re-check the object key against
    // this company and inspection.
    if (!tenantId) { tenantId = await resolveOwnerPreview(c); ownerPreview = !!tenantId; }
    if (!tenantId) return null;
    const gateRow = await getDrizzle(c)
        .select({ reportStatus: inspections.reportStatus })
        .from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
        .get();
    // A gate that holds the report but serves its media is not a gate.
    const releaseGate = await releaseGateFor(c.var.services, id, tenantId, renderMode || ownerPreview);
    if (!publicReportAccessAllowed({ renderMode, ownerPreview, reportStatus: gateRow?.reportStatus, releaseGate })) return null;
    return { tenantId };
}
