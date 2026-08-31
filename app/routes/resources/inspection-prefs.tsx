/**
 * Track H — BFF resource route for tenant inspection-editor preferences
 * (C-12). Replaces useInspectionPrefs' raw client fetches against
 * `/api/tenant/inspection-prefs` with the token-relay pattern.
 *
 * No UI — resource route (loader = GET merged prefs, action = PATCH).
 */
import type { Route } from "./+types/inspection-prefs";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { prefs: null };
    const api = createApi(context, { token });
    try {
        const res = await api.inspectionPrefs.index.$get(
            {},
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { prefs: null };
        return { prefs: await res.json() };
    } catch {
        return { prefs: null };
    }
}

/**
 * NEVER REVALIDATE. React Router re-runs every ACTIVE fetcher after each
 * navigation and each action, and this route is loaded through one
 * (`useInspectionPrefs`). The editor submits an action on essentially every
 * interaction — a rating, a note, a defect field — so the default behaviour
 * re-fetched tenant preferences once per interaction.
 *
 * That is what took the Worker down: a single editor session issued ~1,000
 * requests here, D1 queries backed up past 15s, the isolate exceeded its
 * MEMORY limit and returned 503 — which the app rendered as its error card.
 * The database errors in the logs were the symptom of saturation, not a
 * schema fault.
 *
 * These preferences are read once per mount and updated only through this
 * route's own action, whose response carries the merged result back. There is
 * no path by which a navigation makes them stale, so there is nothing for a
 * revalidation to discover.
 */
export function shouldRevalidate() {
    return false;
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await getToken(context, request);
    if (!token) return { ok: false as const, prefs: null };
    const api = createApi(context, { token });
    const form = await request.formData();
    const raw = String(form.get("patch") ?? "{}");
    let patch: Record<string, unknown>;
    try {
        patch = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return { ok: false as const, prefs: null };
    }
    try {
        const res = await api.inspectionPrefs.index.$patch(
            { json: patch },
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { ok: false as const, prefs: null };
        return { ok: true as const, prefs: await res.json() };
    } catch {
        return { ok: false as const, prefs: null };
    }
}
