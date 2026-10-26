// @vitest-environment happy-dom
/**
 * The phone's full-screen defect search drives the same state as the desktop's
 * inline one: Add toggles the template defect, a library hit seeds the write
 * form, "Write your own" seeds the title from the query, and closing clears the query.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhoneDefectSearch } from "./PhoneDefectSearch";
import type { CannedCommentTabsProps } from "./CannedCommentTabs";

const defect = { id: "d1", title: "Downspout disconnected", category: "recommendation", location: "", comment: "<p>Separated at the elbow</p>", photos: [], default: false };

function setup(over: Partial<CannedCommentTabsProps> = {}) {
    const props = {
        defectQuery: "down", onDefectQueryChange: vi.fn(),
        currentTabEntries: [defect], includedSet: new Set<string>(), onToggleCanned: vi.fn(),
        libraryMatches: [], onSeedFromLibrary: vi.fn(), customDefects: [],
        onAddCustomDefect: vi.fn(), customTitle: "", customComment: "", customCategory: "recommendation",
        saveToLibrary: false, showSaveToLibrary: true, onCustomTitleChange: vi.fn(), onCustomCommentChange: vi.fn(),
        onCustomCategoryChange: vi.fn(), onSaveToLibraryChange: vi.fn(), onSubmitCustomDefect: vi.fn(),
        ...over,
    } as unknown as CannedCommentTabsProps;
    render(<PhoneDefectSearch {...props} itemLabel="Gutters" />);
    fireEvent.click(screen.getByRole("button", { name: /search defects or write your own/i }));
    return props;
}

describe("PhoneDefectSearch", () => {
    it("Add includes the template defect on this item", () => {
        const p = setup();
        expect(screen.getByText("Separated at the elbow")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Add Downspout disconnected" }));
        expect(p.onToggleCanned).toHaveBeenCalledWith("defects", "d1", true);
    });

    it("an added defect reads Added and counts on the bar", () => {
        setup({ includedSet: new Set(["d1"]) });
        expect(screen.getByRole("button", { name: "Remove Downspout disconnected" }).getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByText("1 defect on this item")).toBeTruthy();
    });

    it("the severity chip shows this inspection's override, not the template category", () => {
        setup({ defectStates: new Map([["d1", { category: "c9" }]]), customCategories: [{ id: "c9", name: "maintenance" }] });
        expect(screen.getByText("maintenance")).toBeTruthy();
        expect(screen.queryByText("recommendation")).toBeNull();
    });

    it("Write your own seeds the title from the query and opens the form", () => {
        const p = setup();
        fireEvent.click(screen.getByRole("button", { name: /write your own: “down”/i }));
        expect(p.onCustomTitleChange).toHaveBeenCalledWith("Down");
        expect(screen.getByRole("radiogroup")).toBeTruthy();
    });

    it("a library hit seeds the write form instead of adding a finished defect", () => {
        const match = { id: "l1", text: "Gutter leaks at seams. Reseal joints.", severity: "minor" };
        const p = setup({ currentTabEntries: [], libraryMatches: [match] });
        fireEvent.click(screen.getByRole("button", { name: /^Add Gutter leaks/ }));
        expect(p.onSeedFromLibrary).toHaveBeenCalledWith(match);
        expect(screen.getByRole("heading", { name: "Write a defect" })).toBeTruthy();
    });

    it("Done closes the screen and clears the query", () => {
        const p = setup();
        fireEvent.click(screen.getByRole("button", { name: /done/i }));
        expect(p.onDefectQueryChange).toHaveBeenCalledWith("");
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});
