/**
 * ISN (Inspection Support Network) — credentials and the one HTTP call.
 *
 * Two facts about this API decide everything below, and neither is in its spec
 * (developer.inspectionsupport.com, OpenAPI "v8665"). Both were taken off the
 * wire against a live company on 2026-09-18:
 *
 *   1. ISN answers HTTP 200 to errors — a rejected login, an unknown path, a
 *      wrong verb, a missing field all come back as 200 with
 *      `{ "status": "error", "message": ... }`. A call succeeds only when the
 *      BODY says `status: "ok"`; the status code carries no information.
 *   2. Fields travel in the QUERY STRING. The spec documents PUT bodies as
 *      form-encoded, but `PUT /orders/addreporturl` ignores a form body and
 *      answers "you must provide a url for the report". The same fields in the
 *      query string are read. See tests/contract/isn/isn-api.live.spec.ts.
 */
import { loadTenantSecrets } from '../../lib/secrets-cache';
import { applyIntegrationSecrets } from '../../lib/middleware/integration-secrets';

/** Everything needed to reach one company's ISN. */
export interface IsnConfig {
    /** e.g. https://inspectionsupport.com — white-label companies have their own. */
    domain: string;
    companyKey: string;
    accessKey: string;
    secretKey: string;
}

type IsnEnv = Partial<Record<'ISN_DOMAIN' | 'ISN_COMPANY_KEY' | 'ISN_ACCESS_KEY' | 'ISN_SECRET_KEY', string>>;

/**
 * Null unless all four are set — the integration is simply off. There is no
 * default domain: ISN is white-labelled (4isn.com, goisn.net, ...), and a
 * guessed host fails looking exactly like a bad access key.
 */
export function isnConfig(env: IsnEnv): IsnConfig | null {
    const domain = env.ISN_DOMAIN?.trim().replace(/\/+$/, '');
    const companyKey = env.ISN_COMPANY_KEY?.trim();
    const accessKey = env.ISN_ACCESS_KEY?.trim();
    const secretKey = env.ISN_SECRET_KEY?.trim();
    if (!domain || !companyKey || !accessKey || !secretKey) return null;
    return { domain, companyKey, accessKey, secretKey };
}

/**
 * The Worker env with this tenant's stored secrets merged in (ISN keys are
 * tenant-owned, so the stored value wins). A copy: the Worker env is shared
 * across requests in an isolate and must never be mutated.
 */
export async function isnTenantEnv(
    env: { DB: D1Database; TENANT_CACHE?: KVNamespace; JWT_SECRET?: string; JWT_SECRET_PREVIOUS?: string },
    tenantId: string,
): Promise<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = { ...(env as unknown as Record<string, string | undefined>) };
    if (!env.JWT_SECRET) return out;
    const stored = await loadTenantSecrets(env.DB, env.TENANT_CACHE, tenantId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS)
        .catch(() => null);
    if (stored) applyIntegrationSecrets(out, stored);
    return out;
}

/** ISN's own words, kept whole — see docs/develop/integration-adapters.md. */
export class IsnError extends Error {
    constructor(readonly operation: string, readonly isnMessage: string, readonly httpStatus: number) {
        super(`ISN ${operation}: ${isnMessage}`);
        this.name = 'IsnError';
    }
}

export type IsnBody = { status?: string; message?: string } & Record<string, unknown>;

/** One call. Throws IsnError unless the body says `status: "ok"`. */
export async function isnCall(
    cfg: IsnConfig, method: 'GET' | 'PUT' | 'DELETE', path: string, params?: Record<string, string>,
): Promise<IsnBody> {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    const res = await fetch(`${cfg.domain}/${encodeURIComponent(cfg.companyKey)}/rest${path}${qs}`, {
        method,
        headers: { Authorization: `Basic ${btoa(`${cfg.accessKey}:${cfg.secretKey}`)}`, Accept: 'application/json' },
    });
    const text = await res.text();
    let body: IsnBody | null = null;
    try { body = JSON.parse(text) as IsnBody; } catch { /* not JSON — reported below */ }
    if (body?.status !== 'ok') {
        const message = body?.message || (body ? 'no status in response' : `non-JSON response: ${text.slice(0, 200)}`);
        throw new IsnError(`${method} ${path}`, message, res.status);
    }
    return body;
}
