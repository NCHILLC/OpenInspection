// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushFieldLog, inspectionIdFromPath, logFieldEvent, routeOf, setFieldLogOn } from "./field-log";

const buffered = () => JSON.parse(localStorage.getItem("oi:field-log:buffer") ?? "[]") as { id: string; note?: string; inspectionId?: string; kind?: string; route?: string; status?: number }[];

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

describe("field log recording session", () => {
  const realFetch = window.fetch;
  const fresh = async () => {
    vi.resetModules();
    return import("./field-log");
  };

  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, "", "/inspections/insp-1/edit");
  });
  afterEach(() => {
    window.fetch = realFetch;
  });

  it("wraps fetch once however many times it is installed", async () => {
    const log = await fresh();
    window.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    log.setFieldLogOn(true);
    log.installFieldLog();
    log.installFieldLog();
    await window.fetch("/api/inspections/insp-1?token=secret", { method: "PATCH" });
    const events = buffered();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "request_failed", route: "/api/inspections/insp-1", status: 500 });
  });

  it("does not record its own uploads or other origins", async () => {
    const log = await fresh();
    window.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    log.setFieldLogOn(true);
    log.installFieldLog();
    await window.fetch(log.FIELD_LOG_RESOURCE, { method: "POST" });
    await window.fetch("https://example.com/x");
    expect(buffered()).toEqual([]);
  });

  it("keeps attributing events to the last inspection after navigating away", async () => {
    const log = await fresh();
    log.setFieldLogOn(true);
    log.logFieldEvent("action", "rating");
    window.history.pushState({}, "", "/settings/profile");
    log.logFieldEvent("network", "offline");
    expect(buffered().map((e) => e.inspectionId)).toEqual(["insp-1", "insp-1"]);
  });

  it("leaves nothing behind when turned off while a delivery is in flight", async () => {
    const log = await fresh();
    log.setFieldLogOn(true);
    log.logFieldEvent("action", "rating");
    let finish!: (res: Response) => void;
    const pending = log.flushFieldLog(vi.fn(() => new Promise<Response>((r) => (finish = r))));
    log.setFieldLogOn(false);
    finish(new Response(null, { status: 204 }));
    await pending;
    expect(buffered()).toEqual([]);
  });
});
