// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PhoneFramePreview } from "~/components/template/PhoneFramePreview";
import { ItemEditor } from "~/components/editor/ItemEditor";
import { SideRail } from "~/components/editor/SideRail";

/**
 * The template author and the inspector must see the same item.
 *
 * ⚠️ THIS TEST USED TO COMPARE TWO RENDERINGS; NOW IT ASSERTS THERE IS ONE.
 * The template editor previewed an item through `ItemPreviewPanel`, a separate
 * component that listed the same data in its own markup, and this file existed
 * to catch it drifting from what the inspector's editor drew. The preview now
 * renders `ItemEditor` itself, so the two cannot disagree — and what is worth
 * guarding is that nobody quietly reintroduces an approximation.
 *
 * So the assertion is byte-level: the phone frame's markup must CONTAIN a
 * standalone `ItemEditor` render of the same item. A hand-rolled summary would
 * fail it immediately, which is the whole point.
 */

const ITEM = {
    id: "i1",
    label: "Roof Covering",
    type: "rich",
    tabs: {
        information: [{ id: "n1", title: "Material", comment: "Architectural shingle.", default: true }],
        limitations: [],
        defects: [{ id: "d1", title: "Shingles lifted", comment: "Lifted at ridge.", category: "safety", default: false }],
    },
} as never;

const LEVELS = [
    { id: "S", label: "Satisfactory", abbreviation: "Sat", severity: "good" },
    { id: "D", label: "Defect", abbreviation: "Def", severity: "significant", isDefect: true },
];

const inert = () => { /* preview only */ };

describe("preview parity — the author sees the inspector's component", () => {
    it("the phone frame contains a real ItemEditor render of the same item", () => {
        const preview = renderToStaticMarkup(
            createElement(PhoneFramePreview, {
                selectedItem: ITEM,
                sectionTitle: "Roof",
                ratingLevels: LEVELS,
            } as never),
        );
        const inspector = renderToStaticMarkup(
            createElement(ItemEditor, {
                item: ITEM,
                sectionTitle: "Roof",
                result: {},
                ratingLevels: LEVELS,
                onRating: inert,
                onNotes: inert,
                onNotesBlur: inert,
            } as never),
        );
        expect(preview).toContain(inspector);
    });

    it("frames the preview at the phone width the mobile breakpoint uses", () => {
        const preview = renderToStaticMarkup(
            createElement(PhoneFramePreview, {
                selectedItem: ITEM,
                ratingLevels: LEVELS,
            } as never),
        );
        expect(preview).toContain('data-testid="phone-frame-preview"');
        expect(preview).toMatch(/width:\s*375px/);
    });

    // The author's preview shows the findings indicator too, unlit: there is no
    // inspection behind a template, so F is derived from nothing and reads
    // inactive. Seeing the control at all is the point — its absence here would
    // mean the author is previewing a different screen than the one shipped.
    it("shows the findings indicator, inactive, with no inspection behind it", () => {
        const preview = renderToStaticMarkup(
            createElement(PhoneFramePreview, {
                selectedItem: ITEM,
                ratingLevels: LEVELS,
            } as never),
        );
        expect(preview).toContain('data-testid="findings-indicator"');
        expect(preview).toContain('data-active="false"');
    });

    it("SideRail preview renders included defect comment + chip via shared row", () => {
        // activeResult.tabs shape: Array<{ name; comments: Array<{ included; text; category; ... }> }>
        // included comments carry text (raw Mustache template) and category; no title field.
        const out = renderToStaticMarkup(
            createElement(SideRail, {
                activeItem: { id: "item1", label: "Roof", type: "rich" },
                activeResult: {
                    tabs: [
                        {
                            name: "defects",
                            comments: [
                                { id: "c1", text: "Lifted at ridge.", included: true, category: "safety" },
                            ],
                        },
                    ],
                },
                initialOpen: true,
            } as never),
        );
        expect(out).toContain("Lifted at ridge.");
        expect(out).toContain(">safety<");
    });
});

// Kept quiet: ItemEditor's typeahead hook warns on a bare SSR render.
vi.spyOn(console, "error").mockImplementation(() => { /* noop */ });
