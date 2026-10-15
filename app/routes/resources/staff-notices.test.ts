// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/session.server", () => ({ getToken: vi.fn() }));
vi.mock("~/lib/api-client.server", () => ({ createApi: vi.fn() }));

import { clientLoader } from "./staff-notices";

type Args = Parameters<typeof clientLoader>[0];
const run = (serverLoader: () => Promise<unknown>) =>
  clientLoader({ serverLoader } as unknown as Args);

describe("staff-notices clientLoader", () => {
  it("passes the server payload through", async () => {
    const payload = { notices: [], unread: 3 };
    await expect(run(async () => payload)).resolves.toBe(payload);
  });

  it("turns a failed .data fetch into an empty list instead of the root boundary", async () => {
    const out = await run(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(out).toEqual({ notices: [], unread: 0 });
  });

  it("still throws errors that are not network failures", async () => {
    await expect(
      run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
