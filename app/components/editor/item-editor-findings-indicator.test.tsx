// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { ItemEditor } from "./ItemEditor";

/**
 * F reaches the screen as something SEPARATE from the rating radiogroup —
 * asserted on the rendered output rather than trusted to a code comment.
 * `hasIncludedFindings` is unit-tested beside the projection it lives in; this
 * covers what a pure-function test cannot see. Both editors render this same
 * component, so there is one place for it to be wrong.
 *
 * F IS NOW A CONTROL, and that is a deliberate change. It reads as the fourth
 * tile of IN / NI / NP / F and pressing it is how an inspector says "something
 * is wrong here" — it opens the defects and answers the rating question, since
 * a finding implies the item was inspected. What has NOT changed, and must not,
 * is that F is never a rating VALUE: it stays outside the radiogroup, so
 * choosing it can never clear the IN / NI / NP the inspector recorded.
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

    // It is a button, because it does something. It is NOT a radio, because a
    // radio is one of a mutually exclusive set and F coexists with IN.
    it("is a button and never a radio", () => {
        const { container } = render(<ItemEditor {...base} item={richItem} result={{}} />);
        const el = indicator(container)!;
        expect(el.tagName.toLowerCase()).toBe("button");
        expect(el.getAttribute("role")).toBeNull();
        expect(el.getAttribute("aria-checked")).toBeNull();
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
                // "Inspected" is one of ItemEditor's FALLBACK_LEVELS ids —
                // and it is the honest pairing to assert: the inspector found
                // the item satisfactory AND still recorded something on it.
                result={{ rating: "Inspected", tabs: { defects: [{ cannedId: "d1", included: true }] } }}
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

    // Findings imply inspection: an unanswered item gets the satisfactory tier
    // so IN and F light together, which is what the row is telling the reader.
    it("answers the rating when F is pressed on an unrated item", () => {
        const onRating = vi.fn();
        const { container } = render(
            <ItemEditor {...base} onRating={onRating} item={richItem} result={{}} />,
        );
        fireEvent.click(indicator(container)!);
        expect(onRating).toHaveBeenCalledTimes(1);
        // ItemEditor's FALLBACK_RATING_LEVELS satisfactory tier.
        expect(onRating.mock.calls[0][0]).toBeTruthy();
    });

    // The inspector's own answer wins. Overwriting an explicit Not Inspected
    // would discard both their statement and the limitation explaining it.
    it("leaves an existing rating alone when F is pressed", () => {
        const onRating = vi.fn();
        const { container } = render(
            <ItemEditor {...base} onRating={onRating} item={richItem} result={{ rating: "Not Inspected" }} />,
        );
        fireEvent.click(indicator(container)!);
        expect(onRating).not.toHaveBeenCalled();
    });

    // "There are no defects if there are no findings" — pressing F is how the
    // inspector gets to the place where a finding is recorded.
    it("opens the Defects tab when F is pressed", () => {
        const { container } = render(<ItemEditor {...base} item={richItem} result={{}} />);
        // The item opens on Information, which this template leaves empty, so
        // the defect is not on screen yet.
        expect(within(container).queryByText(/Lifted shingle/)).toBeNull();
        fireEvent.click(indicator(container)!);
        expect(within(container).getByText(/Lifted shingle/)).toBeTruthy();
    });
});
