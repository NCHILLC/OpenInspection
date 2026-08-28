import { describe, it, expect } from "vitest";
import { RATING_PRESETS } from "~/components/template/types";
import { hasIncludedFindings, type ItemTabs } from "./item-tab-projections";

/**
 * D2 — `F` is derived, never a rating level.
 *
 * IN/NI/NP answers what the inspector DID with an item; F answers whether
 * anything is WRONG with it. Spectora lights IN and F together, so they are
 * independent — but `ItemEntry.rating` is one scalar and `RatingSegment` is a
 * radiogroup, so shipping an `IN / NI / NP / F` preset would make choosing F
 * silently clear IN. The report would then disagree with what the inspector saw
 * and nothing would catch it.
 */

/**
 * ⚠️ THE RULE IS NARROW ON PURPOSE. "No level may mean something is wrong" would
 * be WRONG: TREC's `D` (Deficient) and the standard presets' `D` (Defect) are
 * legitimate rating levels, genuinely mutually exclusive with the others — that
 * is how those standards work, and an inspector picking Deficient really is
 * declining to pick Inspected.
 *
 * What cannot exist is a level wearing the FINDINGS name — `F`, "Findings" —
 * because that name is a promise that it coexists with IN, and a radiogroup
 * cannot keep it. Anyone reaching for that has reached for `FindingsIndicator`.
 */
const FINDINGS_SHAPED = /^(f|findings?)$/i;

describe("no shipped rating preset defines a findings-shaped level", () => {
    for (const preset of RATING_PRESETS) {
        it(`"${preset.name}" keeps F out of its levels`, () => {
            for (const level of preset.levels) {
                const names = [level.id, level.abbreviation ?? "", level.label ?? ""];
                for (const n of names) {
                    expect(
                        FINDINGS_SHAPED.test(n.trim()),
                        `"${preset.name}" level ${JSON.stringify(level.id)} uses the findings name ${JSON.stringify(n)}. ` +
                        `F is derived from included defects and rendered by FindingsIndicator beside the rating ` +
                        `control — as a rating level it would clear whatever IN/NI/NP the inspector chose.`,
                    ).toBe(false);
                }
            }
        });
    }

    // The positive control: the rule must not be so loose that it waves through
    // the very preset it exists to stop.
    it("WOULD reject an IN/NI/NP/F preset if one were added", () => {
        const offending = { id: "F", label: "Findings", abbreviation: "F" };
        const names = [offending.id, offending.abbreviation, offending.label];
        expect(names.some((n) => FINDINGS_SHAPED.test(n))).toBe(true);
    });

    // ...and must keep letting the legitimate defect tiers through.
    it("does NOT reject TREC's Deficient or the standard Defect tier", () => {
        for (const n of ["D", "Deficient", "Defect", "INR", "In Need of Repair"]) {
            expect(FINDINGS_SHAPED.test(n), `${n} is a real rating level`).toBe(false);
        }
    });
});

describe("hasIncludedFindings", () => {
    const tabs: ItemTabs = {
        defects: [
            { id: "d1", title: "Lifted shingle", comment: "", default: false },
            { id: "d2", title: "Cracked boot", comment: "", default: true },
        ],
    } as ItemTabs;

    it("is false on an untouched item with no defaulted defects", () => {
        expect(hasIncludedFindings({ defects: [{ id: "d1", title: "x", comment: "", default: false }] } as ItemTabs, {})).toBe(false);
    });

    // The template's `default: true` counts before the inspector touches
    // anything — that is getIncludedSet's precedence, and F must agree with the
    // list the inspector is actually looking at.
    it("is true when the template defaults a defect on", () => {
        expect(hasIncludedFindings(tabs, {})).toBe(true);
    });

    it("is false once the inspector turns the defaulted defect off", () => {
        expect(hasIncludedFindings(tabs, { tabs: { defects: [{ cannedId: "d2", included: false }] } })).toBe(false);
    });

    it("is true when the inspector switches a non-default defect on", () => {
        const off = { tabs: { defects: [{ cannedId: "d2", included: false }, { cannedId: "d1", included: true }] } };
        expect(hasIncludedFindings(tabs, off)).toBe(true);
    });

    it("counts a hand-written custom defect", () => {
        const result = { customComments: { defects: [{ id: "c1", included: true }] } };
        expect(hasIncludedFindings({} as ItemTabs, result)).toBe(true);
    });

    it("ignores a custom defect the inspector excluded", () => {
        const result = { customComments: { defects: [{ id: "c1", included: false }] } };
        expect(hasIncludedFindings({} as ItemTabs, result)).toBe(false);
    });

    // A document written before `included` existed must not silently lose a
    // finding the inspector typed by hand.
    it("treats a custom defect with no `included` flag as included", () => {
        const result = { customComments: { defects: [{ id: "c1" }] } };
        expect(hasIncludedFindings({} as ItemTabs, result)).toBe(true);
    });

    it("is false when the item has no defects at all", () => {
        expect(hasIncludedFindings({} as ItemTabs, {})).toBe(false);
    });
});
