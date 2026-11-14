// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { CannedCommentTabs } from "~/components/editor/CannedCommentTabs";

afterEach(cleanup);

const gutter = { id: "d1", title: "Loose gutter", category: "maintenance", location: "", comment: "Gutter sags.", photos: [], default: false };
const flashing = { id: "d2", title: "Cracked flashing", category: "safety", location: "", comment: "Flashing cracked.", photos: [], default: false };
const copyOfGutter = { id: "c1", title: "Loose gutter", category: "maintenance", comment: "Gutter sags.", included: true, sourceCannedId: "d1" };
const handWritten = { id: "c2", title: "Hand-written defect", category: "maintenance", comment: "", included: true };

function renderTabs(extra: Record<string, unknown> = {}) {
  const props = {
    visibleTabs: [{ id: "defects", label: "Defects" }],
    activeTab: "defects", onChangeTab: () => {},
    rawTabEntries: [gutter, flashing], currentTabEntries: [gutter, flashing],
    includedSet: new Set(["d1"]),
    defectQuery: "", onDefectQueryChange: () => {},
    resultAttributes: {},
    onToggleCanned: () => {},
    defectStates: new Map(), locationSuggestions: [], onDefectFields: () => {},
    missingFields: new Map(), requiredDefectFields: { location: false, trade: false },
    defectPhotoChip: () => null,
    cannedDefectPhotos: () => [],
    libraryMatches: [], onSeedFromLibrary: () => {},
    customDefects: [handWritten, copyOfGutter], onToggleCustomDefect: () => {},
    onAddCustomDefect: undefined, customFormOpen: false, onOpenCustomForm: () => {},
    customTitle: "", customComment: "", customCategory: "recommendation", customTrade: "",
    saveToLibrary: false, showSaveToLibrary: false,
    onCustomTitleChange: () => {}, onCustomCommentChange: () => {},
    onCustomCategoryChange: () => {}, onCustomTradeChange: () => {},
    onSaveToLibraryChange: () => {},
    onCancelCustomForm: () => {}, onSubmitCustomDefect: () => {},
    ...extra,
  };
  return render(<CannedCommentTabs {...(props as unknown as Parameters<typeof CannedCommentTabs>[0])} />);
}

/** Checkbox rows top to bottom: template rows by id, custom rows as `custom:<id>`. */
function order(container: HTMLElement) {
  return [...container.querySelectorAll("input[type=checkbox]")].map((box) => {
    const custom = box.closest("[data-custom-defect-id]");
    if (custom) return `custom:${custom.getAttribute("data-custom-defect-id")}`;
    return box.closest("label")?.textContent?.includes("Cracked") ? "d2" : "d1";
  });
}

describe("CannedCommentTabs — a copied defect", () => {
  /** The copy used to render at the very bottom, below the library: a phone
   *  showed nothing after Copy, and the still-checked copy kept a red defect
   *  line on the item after the inspector unchecked the original. */
  it("lists a copy directly under its original, the hand-written ones after the template list", () => {
    const { container } = renderTabs();
    expect(order(container)).toEqual(["d1", "custom:c1", "d2", "custom:c2"]);
  });

  it("falls back to the bottom list when the original is filtered out", () => {
    const { container } = renderTabs({ currentTabEntries: [flashing] });
    expect(order(container)).toEqual(["d2", "custom:c2", "custom:c1"]);
  });

  it("shows a labelled Copy button on a checked defect and reports the new copy's id", () => {
    const onDuplicateCanned = vi.fn(() => "c-new");
    renderTabs({ onDuplicateCanned });
    const copy = screen.getByRole("button", { name: /^Copy Loose gutter/ });
    expect(copy.textContent).toContain("Copy");
    fireEvent.click(copy);
    expect(onDuplicateCanned).toHaveBeenCalledWith(gutter);
    // Not offered on an unchecked defect.
    expect(screen.queryByRole("button", { name: /^Copy Cracked flashing/ })).toBeNull();
  });

  it("gives the copy its own location field, written by id", () => {
    const onCustomDefectFields = vi.fn();
    const { container } = renderTabs({ onCustomDefectFields });
    const row = container.querySelector('[data-custom-defect-id="c1"]')!;
    fireEvent.click(row.querySelector('[data-testid="defect-location-chip-rear"]')!);
    expect(onCustomDefectFields).toHaveBeenCalledWith("c1", { location: "Rear" });
  });
});

describe("CannedCommentTabs — the per-defect camera button", () => {
  it("is on every checked defect, template and custom, named for it, 44px", () => {
    const onDefectCamera = vi.fn();
    renderTabs({ onDefectCamera });
    const buttons = screen.getAllByRole("button", { name: /^Take photo of / });
    // d1 (checked), its copy c1, hand-written c2; not d2 (unchecked).
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Take photo of Loose gutter", "Take photo of Loose gutter", "Take photo of Hand-written defect",
    ]);
    for (const b of buttons) expect(b.className).toMatch(/\bw-11\b.*\bh-11\b/);
    fireEvent.click(buttons[0]);
    expect(onDefectCamera).toHaveBeenCalledWith({ kind: "canned", id: "d1" }, "Loose gutter");
    fireEvent.click(buttons[2]);
    expect(onDefectCamera).toHaveBeenCalledWith({ kind: "custom", id: "c2" }, "Hand-written defect");
  });

  it("follows Flag in the row's button group", () => {
    renderTabs({ onDefectCamera: () => {} });
    const flag = screen.getAllByRole("button", { name: /flag/i })[0];
    expect(flag.nextElementSibling?.getAttribute("aria-label")).toBe("Take photo of Loose gutter");
  });
});
