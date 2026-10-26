import { describe, it, expect } from "vitest";
import { nextItemTarget, nextUnratedSection } from "./next-item";

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

    // The phone's Next button names its target, so the label rides along.
    it("carries the target's label, falling back to its name", () => {
        const named = [{ id: "s1", items: [{ id: "a", label: "Roof Covering" }, { id: "b", name: "Flashing" }] }];
        expect(nextItemTarget(named, "s1", null)?.label).toBe("Roof Covering");
        expect(nextItemTarget(named, "s1", "a")?.label).toBe("Flashing");
    });
});

describe("nextUnratedSection", () => {
    const S = [
        { id: "s1", title: "Roof", items: [{ id: "a" }] },
        { id: "s2", title: "Empty", items: [] },
        { id: "s3", title: "Exterior", items: [{ id: "b", label: "Siding" }, { id: "c" }] },
    ];
    const rated = (ids: string[]) => (_s: string, i: string) => ids.includes(i);

    it("opens the first section with an unrated item from the inspection", () => {
        expect(nextUnratedSection(S, rated(["a"]), null)).toEqual({ sectionId: "s3", label: "Exterior", itemLabel: "Siding" });
    });

    it("leaves the current checklist even when it still has unrated items", () => {
        expect(nextUnratedSection(S, rated([]), "s1")?.sectionId).toBe("s3");
    });

    it("wraps to an earlier section rather than dead-ending", () => {
        expect(nextUnratedSection(S, rated(["b", "c"]), "s3")?.sectionId).toBe("s1");
    });

    it("is null once every item is rated", () => {
        expect(nextUnratedSection(S, rated(["a", "b", "c"]), null)).toBeNull();
        expect(nextUnratedSection(S, rated(["a", "b"]), "s3")).toBeNull();
    });
});
