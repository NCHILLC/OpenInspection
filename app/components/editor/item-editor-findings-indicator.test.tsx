// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ItemEditor } from "./ItemEditor";

/**
 * D2, asserted on the rendered output rather than trusted to a code comment.
 *
 * `hasIncludedFindings` is unit-tested next to the projection it lives in; what
 * these cover is the part a pure-function test cannot see — that F reaches the
 * screen as something SEPARATE from the rating radiogroup. Both editors render
 * this same component, so there is one place for it to be wrong.
 */

const base = {
    sectionTitle: "Roof",
    onRating: vi.fn(),
    onNotes: vi.fn(),
    onNotesBlur: vi.fn(),
};

const richItem = {
    id: "i1",
    label: "Roof Covering",
    type: "rich",
    tabs: {
        information: [],
        limitations: [],
        defects: [{ id: "d1", title: "Lifted shingle", comment: "At the ridge.", default: false }],
    },
};

const indicator = (c: HTMLElement) => c.querySelector('[data-testid="findings-indicator"]');

describe("ItemEditor — the findings indicator is beside the rating, not in it", () => {
    it("renders F for a rich item", () => {
        const { container } = render(<ItemEditor {...base} item={richItem} result={{}} />);
        expect(indicator(container)).toBeTruthy();
    });

    // The structural half of D2. A radiogroup's children are mutually exclusive;
    // F is not. If this ever fails, selecting F has started clearing IN.
    it("does NOT render F inside the rating radiogroup", () => {
        const { container } = render(<ItemEditor {...base} item={richItem} result={{}} />);
        const group = container.querySelector('[role="radiogroup"]');
        expect(group, "the rating radiogroup should exist").toBeTruthy();
        expect(group?.contains(indicator(container)!)).toBe(false);
    });

    // A control nobody can choose must not claim to be one.
    it("is not exposed as a radio or a button", () => {
        const { container } = render(<ItemEditor {...base} item={richItem} result={{}} />);
        const el = indicator(container)!;
        expect(el.getAttribute("role")).toBeNull();
        expect(el.tagName.toLowerCase()).toBe("output");
    });

    it("reads inactive when the item has no included findings", () => {
        const { container } = render(<ItemEditor {...base} item={richItem} result={{}} />);
        expect(indicator(container)?.getAttribute("data-active")).toBe("false");
    });

    it("reads active once a defect is included", () => {
        const { container } = render(
            <ItemEditor {...base} item={richItem} result={{ tabs: { defects: [{ cannedId: "d1", included: true }] } }} />,
        );
        expect(indicator(container)?.getAttribute("data-active")).toBe("true");
    });

    // The case that motivated deriving F at all: the inspector marked the item
    // inspected AND recorded something wrong with it. Both must show at once.
    it("stays active while a rating is also selected", () => {
        const { container } = render(
            <ItemEditor
                {...base}
                item={richItem}
                // "Satisfactory" is one of ItemEditor's FALLBACK_LEVELS ids —
                // and it is the honest pairing to assert: the inspector found
                // the item satisfactory AND still recorded something on it.
                result={{ rating: "Satisfactory", tabs: { defects: [{ cannedId: "d1", included: true }] } }}
            />,
        );
        expect(indicator(container)?.getAttribute("data-active")).toBe("true");
        expect(container.querySelector('[role="radiogroup"] [aria-checked="true"]')).toBeTruthy();
    });

    it("is absent for a non-rich item, which has no findings tab", () => {
        const { container } = render(
            <ItemEditor {...base} item={{ id: "i2", label: "Year Built", type: "number" }} result={{}} />,
        );
        expect(indicator(container)).toBeNull();
    });
});
