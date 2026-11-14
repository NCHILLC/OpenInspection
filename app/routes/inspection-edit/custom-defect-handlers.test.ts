import { describe, it, expect, vi } from "vitest";
import { customDefectHandlers } from "./custom-defect-handlers";

const at = { sectionId: "roof", itemId: "gutters" };
const entry = { id: "d1", title: "Loose gutter", comment: "Gutter sags.", category: "maintenance" } as never;

describe("customDefectHandlers", () => {
  it("Copy writes a checked custom defect tagged with its original and returns its id", () => {
    const addCustomDefect = vi.fn();
    const id = customDefectHandlers({ addCustomDefect }, () => at).onDuplicateCanned(entry);
    expect(addCustomDefect).toHaveBeenCalledTimes(1);
    const [sectionId, itemId, written] = addCustomDefect.mock.calls[0];
    expect([sectionId, itemId]).toEqual(["roof", "gutters"]);
    expect(written).toMatchObject({ id, title: "Loose gutter", comment: "Gutter sags.", category: "maintenance", included: true, sourceCannedId: "d1" });
  });

  it("does nothing with no item open", () => {
    const addCustomDefect = vi.fn();
    expect(customDefectHandlers({ addCustomDefect }, () => null).onDuplicateCanned(entry)).toBeUndefined();
    expect(addCustomDefect).not.toHaveBeenCalled();
  });

  it("writes only the location onto the existing entry, and clears with an empty string", () => {
    const addCustomDefect = vi.fn();
    const h = customDefectHandlers({ addCustomDefect }, () => at);
    h.onCustomDefectFields("c1", { location: "Rear" });
    h.onCustomDefectFields("c1", { location: null });
    expect(addCustomDefect.mock.calls).toEqual([
      ["roof", "gutters", { id: "c1", location: "Rear" }],
      ["roof", "gutters", { id: "c1", location: "" }],
    ]);
  });
});
