import type { createApi } from "~/lib/api-client.server";
import type { IsnSync } from "~/components/editor/PublishModal";

type Api = ReturnType<typeof createApi>;

/**
 * The publish receipt's "Send to ISN again": the ISN step of publishing alone,
 * so a fixed Reference Number or client email reaches ISN without a new version
 * or the delivery automations a republish fires. Same contract as
 * `handleFollowupIntent`: `null` means not this module's intent.
 */
export async function handleIsnIntent(intent: string, api: Api, inspectionId: string) {
 if (intent !== "isn-report-link") return null;
 const res = await api.inspections[":id"].isn["report-link"].$post({ param: { id: inspectionId } });
 const body = (await res.json().catch(() => null)) as { data?: IsnSync | null; error?: { message?: string } } | null;
 const isnSync: IsnSync | null = res.ok ? (body?.data ?? null) : { ok: false, error: body?.error?.message ?? "Request failed" };
 return { ok: res.ok, intent, isnSync };
}
