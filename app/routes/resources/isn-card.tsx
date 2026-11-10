/**
 * BFF resource route for the ISN card (inspection page + editor settings sheet).
 * loader: GET /api/inspections/:id/isn — null when the inspection did not come
 * from ISN, or on any failure (the card then renders nothing).
 */
import type { Route } from "./+types/isn-card";
import { getToken, requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    const inspectionId = new URL(request.url).searchParams.get("inspectionId");
    if (!token || !inspectionId) return null;
    const res = await createApi(context, { token }).inspections[":id"].isn
        .$get({ param: { id: inspectionId } }, { headers: { "x-token-relay": "1" } })
        .catch(() => null);
    if (!res?.ok) return null;
    return (await res.json()).data;
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await requireToken(context, request);
    const form = await request.formData();
    const id = String(form.get("inspectionId") ?? "");
    if (!id) return { ok: false as const, error: "Missing inspection id" };
    const intent = String(form.get("intent") ?? "refresh");
    if (intent !== "refresh" && intent !== "apply-template") return { ok: false as const, error: "Unknown ISN action" };
    try {
        const isn = createApi(context, { token }).inspections[":id"].isn;
        const post = intent === "apply-template" ? isn["apply-template"].$post : isn.refresh.$post;
        const res = await post(
            { param: { id } }, { headers: { "Idempotency-Key": String(form.get("idempotencyKey") ?? "") } },
        );
        if (res.ok) return { ok: true as const };
        const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        return { ok: false as const, error: body?.error?.message ?? "ISN refresh failed. Try again." };
    } catch {
        return { ok: false as const, error: "ISN refresh failed. Try again." };
    }
}
