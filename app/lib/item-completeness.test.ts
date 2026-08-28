import { describe, it, expect } from "vitest";
import { isItemComplete } from "./item-completeness";

/**
 * The predicate the progress ring, the section rail and report search all read.
 *
 * The cases that matter are the non-rich ones: before this was one function,
 * the ring counted a filled-in text item and the section rail did not, so a
 * section could read 0% while the total said the work was done.
 */
describe("isItemComplete", () => {
    it("is false for an untouched item", () => {
        expect(isItemComplete({})).toBe(false);
        expect(isItemComplete(undefined)).toBe(false);
        expect(isItemComplete(null)).toBe(false);
    });

    it("is true once a rating is set", () => {
        expect(isItemComplete({ rating: "Satisfactory" })).toBe(true);
    });

    // THE DIVERGENCE. A text/number/date/photo_only item cannot be rated — its
    // editor offers no rating control — so holding it to one made whole
    // sections unable to reach 100%.
    it("is true for a non-rich item holding a value, with no rating", () => {
        expect(isItemComplete({ value: "1998" })).toBe(true);
        expect(isItemComplete({ value: 0 })).toBe(true);
        expect(isItemComplete({ value: false })).toBe(true);
        expect(isItemComplete({ value: ["asphalt"] })).toBe(true);
    });

    // Zero and false are ANSWERS. A year of 0 is odd, but "the inspector typed
    // something" is the question being asked, and treating falsy-but-present as
    // unanswered is how a filled field reads as empty.
    it("counts falsy-but-present values as answered", () => {
        expect(isItemComplete({ value: 0 })).toBe(true);
        expect(isItemComplete({ value: false })).toBe(true);
    });

    it("is false for the shapes that mean nobody answered", () => {
        expect(isItemComplete({ value: "" })).toBe(false);
        expect(isItemComplete({ value: null })).toBe(false);
        expect(isItemComplete({ value: undefined })).toBe(false);
        // An empty multi-select is an unanswered field, not an answer of "none".
        expect(isItemComplete({ value: [] })).toBe(false);
    });

    it("prefers the rating when both are present", () => {
        expect(isItemComplete({ rating: "Defect", value: "" })).toBe(true);
    });
});
