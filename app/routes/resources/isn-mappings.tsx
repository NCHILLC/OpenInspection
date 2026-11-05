import type { Route } from "./+types/isn-mappings";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

async function errorMessage(res: Response) {
    const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    return body?.error?.message ?? "ISN template mappings are unavailable. Try again.";
}

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await requireToken(context, request);
    try {
        const res = await createApi(context, { token }).integrations.isn["order-types"].$get();
        if (!res.ok) return { ok: false as const, error: await errorMessage(res) };
        return { ok: true as const, data: (await res.json()).data };
    } catch {
        return { ok: false as const, error: "ISN template mappings are unavailable. Try again." };
    }
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await requireToken(context, request);
    const form = await request.formData();
    const orderTypeId = String(form.get("orderTypeId") ?? "");
    const templateId = String(form.get("templateId") ?? "").trim() || null;
    if (!orderTypeId) return { ok: false as const, error: "Choose an ISN order type." };
    try {
        const res = await createApi(context, { token }).integrations.isn["order-types"][":orderTypeId"].template.$put({
            param: { orderTypeId }, json: { templateId },
        }, { headers: { "Idempotency-Key": String(form.get("idempotencyKey") ?? "") } });
        return res.ok ? { ok: true as const } : { ok: false as const, error: await errorMessage(res) };
    } catch {
        return { ok: false as const, error: "ISN template mappings are unavailable. Try again." };
    }
}
