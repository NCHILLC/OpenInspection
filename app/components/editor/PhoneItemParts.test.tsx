import { describe, it, expect } from "vitest";
import { missingLocationCount, phoneTabs } from "./PhoneItemParts";
import type { ItemTabs } from "../editor-shared/item-tab-projections";

const defect = (id: string, location = "") => ({ id, title: id, category: "safety", location, comment: "", photos: [], default: false });
const tabs: ItemTabs = { defects: [defect("a"), defect("b"), defect("c", "Attic")] };
const included = (...ids: string[]) => ({ tabs: { defects: ids.map((cannedId) => ({ cannedId, included: true })) } });

describe("missingLocationCount (same rule as the server publish gate)", () => {
    it("counts included defects with no location when the policy requires one", () => {
        expect(missingLocationCount(tabs, included("a", "b"), undefined, true, undefined)).toBe(2);
    });
    it("a location typed on the defect or set on the template entry satisfies it", () => {
        const states = new Map([["a", { location: "Rear" }]]);
        expect(missingLocationCount(tabs, included("a", "c"), states, true, undefined)).toBe(0);
    });
    it("counts nothing when the policy does not require a location and the gate flagged nothing", () => {
        expect(missingLocationCount(tabs, included("a", "b"), undefined, false, undefined)).toBe(0);
    });
    it("a defect the last gate run flagged counts even without the policy", () => {
        expect(missingLocationCount(tabs, included("a", "b"), undefined, false, new Map([["b", { location: true }]]))).toBe(1);
    });
    it("unchecked defects never count", () => {
        expect(missingLocationCount(tabs, included(), undefined, true, undefined)).toBe(0);
    });
});

describe("phoneTabs", () => {
    it("puts Defects first and keeps the rest in canvas order", () => {
        const order = phoneTabs([
            { id: "information" as const, label: "Information" },
            { id: "limitations" as const, label: "Limitations" },
            { id: "defects" as const, label: "Defects" },
        ]).map((t) => t.id);
        expect(order).toEqual(["defects", "information", "limitations"]);
    });
});
