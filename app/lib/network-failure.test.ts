import { afterEach, describe, expect, it, vi } from "vitest";
import { isNetworkFailure } from "./network-failure";

afterEach(() => vi.unstubAllGlobals());

describe("isNetworkFailure", () => {
  it.each([
    ["Chrome", "Failed to fetch"],
    ["Chrome dynamic import", "Failed to fetch dynamically imported module: https://x/a.js"],
    ["Safari", "Load failed"],
    ["Firefox", "NetworkError when attempting to fetch resource."],
  ])("recognises the %s fetch failure while online", (_engine, message) => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(isNetworkFailure(new TypeError(message))).toBe(true);
  });

  it("treats any error as a network failure while the browser is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isNetworkFailure(new TypeError("error loading dynamically imported module"))).toBe(true);
  });

  it("leaves a real bug alone while online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(isNetworkFailure(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isNetworkFailure(new Error("Failed to fetch"))).toBe(false);
    expect(isNetworkFailure("Failed to fetch")).toBe(false);
  });

  it("does not need a navigator (SSR)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isNetworkFailure(new Error("boom"))).toBe(false);
  });
});
