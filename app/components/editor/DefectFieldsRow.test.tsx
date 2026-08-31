// @vitest-environment happy-dom
/**
 * Severity is the thing an inspector sets per defect, and before this control
 * existed they could not set it at all — every defect published with whatever
 * category the canned library carried, usually the built-in "recommendation".
 *
 * What is pinned here is the part whose failure is SILENT: a severity that
 * looks chosen on screen but was never written would publish as the template's
 * category, and the report would quietly disagree with what the inspector saw.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DefectFieldsRow } from "./DefectFieldsRow";

const CATEGORIES = [
  { id: "cat-minor", name: "Minor" },
  { id: "cat-moderate", name: "Moderate" },
  { id: "cat-safety", name: "Safety/Major" },
];

// The real editor renders this row INSIDE a <label> that owns the defect's
// inclusion checkbox (CannedCommentRow, as="label"). Rendering it bare passes
// while the shipped UI is unusable — a click on a button inside a label is
// forwarded to the label's control. Every test here uses the real nesting.
function renderRow(value: Record<string, unknown>, onChange = vi.fn()) {
  render(
    <label>
      <input type="checkbox" data-testid="inclusion" onChange={() => {}} checked readOnly />
      <DefectFieldsRow
        cannedId="d1"
        value={value}
        locationSuggestions={[]}
        onChange={onChange}
        categories={CATEGORIES}
      />
    </label>,
  );
  return onChange;
}

describe("DefectFieldsRow severity", () => {
  it("offers every configured severity as a control", () => {
    renderRow({ category: "cat-minor" });
    for (const c of CATEGORIES) {
      expect(screen.getByTestId(`defect-severity-${c.id}`)).toBeTruthy();
    }
  });

  it("marks the stored severity as the selected one", () => {
    renderRow({ category: "cat-safety" });
    expect(screen.getByTestId("defect-severity-cat-safety").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("defect-severity-cat-minor").getAttribute("aria-checked")).toBe("false");
  });

  it("writes the chosen severity from inside the row's label", () => {
    const onChange = renderRow({ category: "cat-minor" });
    onChange.mockClear();
    const tile = screen.getByTestId("defect-severity-cat-safety");
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    tile.dispatchEvent(evt);
    expect(onChange).toHaveBeenCalledWith("d1", { category: "cat-safety" });
    // The label must not also receive it — that toggles the defect's inclusion.
    expect(evt.defaultPrevented).toBe(true);
  });

  // Not merely displayed as selected — PERSISTED. A default that only existed
  // on screen would publish as the template's category instead.
  it("persists the first configured severity when none is stored", () => {
    const onChange = renderRow({});
    expect(onChange).toHaveBeenCalledWith("d1", { category: "cat-minor" });
  });

  it("does not overwrite a severity that is already stored", () => {
    const onChange = renderRow({ category: "cat-moderate" });
    expect(onChange).not.toHaveBeenCalled();
  });

  // The editor passes a FRESH inline arrow every render. If that identity is a
  // dependency of the defaulting effect, the effect re-fires on every render —
  // and when the write does not round-trip into `value.category` (the value
  // below never changes, exactly as a dropped patch would look) it becomes an
  // unbounded loop of writes that pegs the CPU. One call, no matter how many
  // renders or how many different callbacks.
  it("applies the default once even when the parent re-renders with a new callback", () => {
    cleanup();
    const calls: unknown[][] = [];
    const props = { cannedId: "d1", value: {}, locationSuggestions: [], categories: CATEGORIES };
    const { rerender } = render(
      <DefectFieldsRow {...props} onChange={(...a: unknown[]) => calls.push(a)} />,
    );
    for (let i = 0; i < 5; i++) {
      rerender(<DefectFieldsRow {...props} onChange={(...a: unknown[]) => calls.push(a)} />);
    }
    expect(calls).toHaveLength(1);
  });
});

describe("DefectFieldsRow retired controls", () => {
  // Trade/deadline/timeframe were removed from this product's reporting. The
  // trade one mattered most: it was a REQUIRED field, so leaving it rendered
  // while the publish gate still demanded it was the whole bug.
  it("renders no trade, deadline or timeframe controls", () => {
    renderRow({ category: "cat-minor" });
    // <select> is the element those three used; the surviving location input
    // is an <input list=...>, which is a combobox by role but not a select.
    expect(document.querySelectorAll("select")).toHaveLength(0);
    for (const label of [/trade/i, /deadline/i, /timeframe/i]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("still renders the location field", () => {
    renderRow({ category: "cat-minor" });
    expect(document.querySelector('input[type="text"]')).toBeTruthy();
  });
});
