// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { ItemCommentsPanel } from "~/components/template/ItemCommentsPanel";

const item = {
  id: "i1",
  label: "Roof",
  type: "rich",
  tabs: {
    information: [] as unknown[],
    limitations: [] as unknown[],
    defects: [{ id: "d1", title: "Shingles lifted", comment: "Lifted at ridge.", abbrev: "shglft" }],
  },
};

function renderPanel() {
  return render(
    createElement(ItemCommentsPanel, {
      selectedItem: item,
      activeSection: 0,
      editingItem: "i1",
      sections: [{ id: "s1", title: "Roof", items: [item] }],
      updateSections: () => {},
      addCannedToItem: () => {},
      removeCannedFromItem: () => {},
    } as never),
  );
}

describe("ItemCommentsPanel (behavior-preserving swap)", () => {
  it("renders the three tab groups with an + Add control each", () => {
    const { container } = renderPanel();
    for (const tab of ["information", "limitations", "defects"]) {
      expect(container.textContent?.toLowerCase()).toContain(tab);
    }
    expect(screen.getAllByText("+ Add").length).toBe(3);
  });

  it("renders an editable title input, and reveals the comment textarea once expanded", () => {
    renderPanel();
    expect(screen.getByDisplayValue("Shingles lifted")).toBeTruthy();
    expect(screen.queryByText("Lifted at ridge.")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand comment"));
    const textarea = screen.getByPlaceholderText("Comment text...") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Lifted at ridge.");
  });

  it("keeps the delete control per entry", () => {
    renderPanel();
    expect(screen.getByLabelText("Delete comment")).toBeTruthy();
  });

  it("keeps the reorder controls, and reveals the abbrev input once expanded", () => {
    renderPanel();
    expect(screen.getByLabelText("Move up")).toBeTruthy();
    expect(screen.getByLabelText("Move down")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Expand comment"));
    expect(screen.getByPlaceholderText("abbr")).toHaveProperty("value", "shglft");
  });

  it("keeps the comment textarea + its text after expanding", () => {
    // Guard: the CommentTypeahead wiring must not remove the editable textarea.
    renderPanel();
    fireEvent.click(screen.getByLabelText("Expand comment"));
    const textarea = screen.getByPlaceholderText("Comment text...") as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.value).toBe("Lifted at ridge.");
  });
});
