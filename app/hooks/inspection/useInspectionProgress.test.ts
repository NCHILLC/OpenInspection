// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useInspectionProgress } from "./useInspectionProgress";
import type { InspectionContext } from "./helpers";

describe("sectionDefectCount", () => {
    // An IN/NI/NP rating system has no defect level: the finding is the included
    // defect underneath, the same thing that lights the item's F.
    it("counts an item with an included defect under a non-defect rating", () => {
        const sections = [{
            id: "roof",
            items: [
                { id: "a", tabs: { defects: [{ id: "d1", default: false }] } },
                { id: "b", tabs: { defects: [{ id: "d2", default: false }] } },
                { id: "c" },
                { id: "d" },
            ],
        }];
        const results: Record<string, Record<string, unknown>> = {
            a: { rating: "IN", tabs: { defects: [{ cannedId: "d1", included: true }] } },
            b: { rating: "IN" },
            c: { rating: "IN", customComments: { defects: [{ included: true }] } },
            d: { rating: "DEF" },
        };
        const ctx = {
            sections,
            ratingLevels: [{ id: "IN" }, { id: "DEF", isDefect: true }],
            getResult: (itemId: string) => results[itemId] ?? {},
            severityForRatingId: () => null,
        } as unknown as InspectionContext;
        const { result } = renderHook(() => useInspectionProgress(ctx));
        expect(result.current.sectionDefectCount("roof")).toBe(3);
    });
});
