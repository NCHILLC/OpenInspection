import { describe, it, expect } from "vitest";
import { nextItemTarget } from "./next-item";

const SECTIONS = [
    { id: "s1", items: [{ id: "a" }, { id: "b" }] },
    { id: "s2", items: [] },
    { id: "s3", items: [{ id: "c" }] },
];

describe("nextItemTarget", () => {
    it("advances within a section", () => {
        expect(nextItemTarget(SECTIONS, "s1", "a")).toEqual({ sectionId: "s1", itemId: "b" });
    });

    // The walk is front-to-back through the report. Stopping at a section edge
    // would cost three taps to keep doing the same thing.
    it("crosses into the next section at the end of one", () => {
        expect(nextItemTarget(SECTIONS, "s1", "b")).toEqual({ sectionId: "s3", itemId: "c" });
    });

    it("steps over an empty section rather than landing on it", () => {
        expect(nextItemTarget(SECTIONS, "s1", "b")?.sectionId).toBe("s3");
    });

    it("is null on the last item of the last section", () => {
        expect(nextItemTarget(SECTIONS, "s3", "c")).toBeNull();
    });

    // On the item list, the same control means "start this section".
    it("starts the current section when no item is active", () => {
        expect(nextItemTarget(SECTIONS, "s3", null)).toEqual({ sectionId: "s3", itemId: "c" });
    });

    // On the section list, it means "begin the inspection".
    it("starts the report when there is no section either", () => {
        expect(nextItemTarget(SECTIONS, null, null)).toEqual({ sectionId: "s1", itemId: "a" });
    });

    it("starts the report rather than dead-ending on an unresolvable item", () => {
        expect(nextItemTarget(SECTIONS, null, "gone")).toEqual({ sectionId: "s1", itemId: "a" });
    });

    it("is null when the template has no items at all", () => {
        expect(nextItemTarget([{ id: "s1", items: [] }], "s1", null)).toBeNull();
        expect(nextItemTarget([], null, null)).toBeNull();
    });

    // A section pointer with no items of its own still finds the report's start.
    it("falls forward from an empty current section", () => {
        expect(nextItemTarget(SECTIONS, "s2", null)).toEqual({ sectionId: "s1", itemId: "a" });
    });
});
