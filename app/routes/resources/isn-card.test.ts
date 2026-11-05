import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn(async () => "session-token"), getToken: vi.fn(async () => "session-token") }));
vi.mock("~/lib/api-client.server", () => ({ createApi: () => ({ inspections: { ":id": { isn: { refresh: { $post: post } } } } }) }));
import { action } from "./isn-card";

const run = () => action({ request: new Request("http://localhost/resources/isn-card", {
    method: "POST", body: new URLSearchParams({ inspectionId: "inspection-1", idempotencyKey: "retry-key" }),
}), context: {} } as never);

beforeEach(() => { post.mockReset(); });
describe("ISN refresh action", () => {
    it("relays the inspection and retry key and reports success", async () => {
        post.mockResolvedValue(new Response('{"success":true}'));
        expect(await run()).toEqual({ ok: true });
        expect(post).toHaveBeenCalledWith({ param: { id: "inspection-1" } }, { headers: { "Idempotency-Key": "retry-key" } });
    });
    it("keeps the API’s actionable error", async () => {
        post.mockResolvedValue(new Response('{"error":{"message":"ISN intake is off"}}', { status: 503 }));
        expect(await run()).toEqual({ ok: false, error: "ISN intake is off" });
    });
    it("returns a retry message for a transport failure", async () => {
        post.mockRejectedValue(new Error("network"));
        expect(await run()).toEqual({ ok: false, error: "ISN refresh failed. Try again." });
    });
});
