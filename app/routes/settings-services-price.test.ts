// @vitest-environment node
/**
 * The services form takes dollars; the API takes integer cents (`z.number().int()`).
 * `Number("17.99") * 100` is 1798.9999999999998, so a price with cents reached the
 * API as a float and the save was refused. These run the real action and read what
 * it hands the API.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const seam = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }));

vi.mock("~/lib/session.server", () => ({
    requireToken: vi.fn().mockResolvedValue("tok"),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        services: {
            index: {
                $post: async ({ json }: { json: Record<string, unknown> }) => {
                    seam.sent.push(json);
                    return new Response("{}", { status: 201 });
                },
            },
            ":id": {
                $put: async ({ json }: { json: Record<string, unknown> }) => {
                    seam.sent.push(json);
                    return new Response("{}", { status: 200 });
                },
            },
        },
    }),
}));

import { action } from "~/routes/settings-services";
import { routeArgs } from "../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof action>[0]["context"];

function submit(fields: Record<string, string>) {
    const request = new Request("https://x/settings/services", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
    });
    return action(routeArgs(request, { params: {}, context: CONTEXT }));
}

describe("settings-services action: price dollars to cents", () => {
    beforeEach(() => {
        seam.sent = [];
    });

    it.each([
        ["17.99", 1799],
        ["9.95", 995],
        ["450", 45000],
        ["", 0],
    ])("create sends %j as %d integer cents", async (price, cents) => {
        await submit({ intent: "create-service", name: "Full inspection", price });
        expect(seam.sent[0].price).toBe(cents);
    });

    it("update sends a price with cents as integer cents", async () => {
        await submit({ intent: "update-service", id: "svc-1", name: "Full inspection", price: "17.99" });
        expect(seam.sent[0].price).toBe(1799);
    });
});
