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
import { render, screen, fireEvent } from "@testing-library/react";
import { DefectFieldsRow } from "./DefectFieldsRow";

const CATEGORIES = [
  { id: "cat-minor", name: "Minor" },
  { id: "cat-moderate", name: "Moderate" },
  { id: "cat-safety", name: "Safety/Major" },
];

function renderRow(value: Record<string, unknown>, onChange = vi.fn()) {
  render(
    <DefectFieldsRow
      cannedId="d1"
      value={value}
      locationSuggestions={[]}
      onChange={onChange}
      categories={CATEGORIES}
    />,
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

  it("writes the chosen severity", () => {
    const onChange = renderRow({ category: "cat-minor" });
    onChange.mockClear();
    fireEvent.click(screen.getByTestId("defect-severity-cat-safety"));
    expect(onChange).toHaveBeenCalledWith("d1", { category: "cat-safety" });
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
