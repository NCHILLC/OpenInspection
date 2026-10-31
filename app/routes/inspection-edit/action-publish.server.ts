import type { createApi } from "~/lib/api-client.server";

const DEFAULT_MESSAGE = "Couldn't publish the report. Please try again.";

/** The AppError body ({ error: { message } }) of a refused publish step, or a default. */
export async function publishFailureMessage(res: { text(): Promise<string> }): Promise<string> {
 const bodyText = await res.text().catch(() => "");
 try {
 const parsed = JSON.parse(bodyText) as { error?: { message?: string }; message?: string };
 return parsed?.error?.message ?? parsed?.message ?? DEFAULT_MESSAGE;
 } catch {
 return DEFAULT_MESSAGE; // non-JSON body
 }
}

/**
 * Read-only check the publish intent makes FIRST: complete fires an automation
 * and the auto-sign patch writes the row, neither of which may happen for a
 * report that publish will refuse. Returns the refusal, or null to carry on.
 */
export async function publishPreflight(api: ReturnType<typeof createApi>, id: string) {
 const res = await (api.inspections[":id"] as unknown as {
 "publish-check": { $get: (args: { param: { id: string }; query: Record<string, never> }) => Promise<Response> };
 })["publish-check"].$get({ param: { id }, query: {} });
 return res.ok ? null : { ok: false as const, intent: "publish", error: await publishFailureMessage(res) };
}
