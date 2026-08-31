import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CannedCommentTabs } from "~/components/editor/CannedCommentTabs";

const cannedDefect = {
  id: "d1", title: "Roof shingles lifted", category: "safety",
  location: "", comment: "Shingles are lifted at the ridge.", photos: [], default: false,
};
const customDefect = {
  id: "c1", title: "Gutter loose", category: "maintenance",
  comment: "Gutter is pulling away.", included: true, photos: [] as Array<{ key: string }>,
};

function html(includedIds: string[]) {
  return renderToStaticMarkup(
    createElement(CannedCommentTabs, {
      visibleTabs: [{ id: "defects", label: "Defects" }],
      activeTab: "defects",
      onChangeTab: () => {},
      rawTabEntries: [cannedDefect],
      currentTabEntries: [cannedDefect],
      includedSet: new Set(includedIds),
      defectQuery: "",
      onDefectQueryChange: () => {},
      resultAttributes: undefined,
      onToggleCanned: () => {},
      defectStates: new Map(),
      locationSuggestions: [],
      onDefectFields: () => {},
      missingFields: new Map(),
      requiredDefectFields: { location: false, trade: false },
      defectPhotoChip: () => createElement("button", { "data-testid": "photo-chip" }, "Add photo"),
      cannedDefectPhotoCount: () => 0,
      libraryMatches: [],
      onSeedFromLibrary: () => {},
      customDefects: [customDefect],
      onToggleCustomDefect: () => {},
      onAddCustomDefect: undefined,
      customFormOpen: false,
      onOpenCustomForm: () => {},
      customTitle: "", customComment: "", customCategory: "recommendation", customTrade: "",
      saveToLibrary: false, showSaveToLibrary: false,
      onCustomTitleChange: () => {}, onCustomCommentChange: () => {},
      onCustomCategoryChange: () => {}, onCustomTradeChange: () => {},
      onSaveToLibraryChange: () => {},
      onCancelCustomForm: () => {}, onSubmitCustomDefect: () => {},
    } as never),
  );
}

describe("CannedCommentTabs category pills", () => {
  // The canned-defect row no longer carries a read-only category pill. It
  // showed the TEMPLATE's category — for most seeded defects the built-in
  // "recommendation", which is not a severity anyone chose — and severity is
  // now set on the row itself via DefectFieldsRow. A pill repeating a
  // different value beside that control would contradict it.
  it("renders no read-only category pill on a canned defect", () => {
    const out = html([]);
    expect(out).not.toContain(">safety<");
  });

  it("renders the custom-defect maintenance pill with the canonical muted tokens", () => {
    const out = html([]);
    expect(out).toContain("bg-ih-bg-muted");
    expect(out).toContain(">maintenance<");
    // IA-62 — the inspector-added badge (formerly "custom") still present
    expect(out).toContain(">inspector-added<");
  });
});
