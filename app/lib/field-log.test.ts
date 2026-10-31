// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushFieldLog, inspectionIdFromPath, logFieldEvent, routeOf, setFieldLogOn } from "./field-log";

const buffered = () => JSON.parse(localStorage.getItem("oi:field-log:buffer") ?? "[]") as { id: string; note?: string }[];

describe("field log buffer", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, "", "/inspections/insp-1/edit");
  });

  it("records nothing while off", () => {
    logFieldEvent("action", "rating");
    expect(buffered()).toEqual([]);
  });

  it("stamps the inspection from the path", () => {
    setFieldLogOn(true);
    logFieldEvent("action", "rating");
    expect(buffered()[0]).toMatchObject({ inspectionId: "insp-1", kind: "action", name: "rating" });
  });

  it("keeps events through a failed upload, and clears them on success", async () => {
    setFieldLogOn(true);
    logFieldEvent("action", "rating");
    await flushFieldLog(vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(buffered()).toHaveLength(1);
    await flushFieldLog(vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    expect(buffered()).toHaveLength(1);
    await flushFieldLog(vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(buffered()).toEqual([]);
  });

  it("drops a batch the server refuses, so it cannot retry forever", async () => {
    setFieldLogOn(true);
    logFieldEvent("action", "rating");
    await flushFieldLog(vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    expect(buffered()).toEqual([]);
  });

  it("wipes the buffer when turned off", () => {
    setFieldLogOn(true);
    logFieldEvent("action", "rating");
    setFieldLogOn(false);
    expect(buffered()).toEqual([]);
  });
});

describe("routeOf", () => {
  it("drops the query and masks token-shaped segments", () => {
    expect(routeOf("/contacts/search?q=jane@example.com")).toBe("/contacts/search");
    expect(routeOf(`/report/${"a".repeat(64)}/view`)).toBe("/report/:token/view");
  });
});

describe("inspectionIdFromPath", () => {
  it("skips the pages that are not an inspection", () => {
    expect(inspectionIdFromPath("/inspections/abc/edit")).toBe("abc");
    expect(inspectionIdFromPath("/inspections/new")).toBeNull();
    expect(inspectionIdFromPath("/settings/profile")).toBeNull();
  });
});
