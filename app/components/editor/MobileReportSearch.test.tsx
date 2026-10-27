// @vitest-environment happy-dom
/**
 * Canvas X5: the phone search's Items / Defects tabs, their counts, and the row
 * formats ("IN · 1 finding", "Not rated · up next", "Roof › Gutters & Downspouts · Rear").
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MobileReportSearch } from "./MobileReportSearch";
import { itemStatusText } from "./report-search-rows";

const defect = (id: string, title: string, category = "minor", location = "") => ({ id, title, category, location, comment: "", photos: [], default: false });

const sections = [
    {
        id: "roof",
        title: "Roof",
        items: [
            { id: "covering", label: "Roof Covering", tabs: { defects: [defect("shingles", "Missing shingles", "moderate")] } },
            { id: "gutters", label: "Gutters & Downspouts", tabs: { defects: [defect("discharge", "Discharge at foundation", "moderate")] } },
            { id: "chimney", label: "Chimney" },
            { id: "flashing", label: "Flashing" },
        ],
    },
    { id: "ext", title: "Exterior", items: [{ id: "siding", label: "Siding" }] },
];

const results: Record<string, Record<string, unknown>> = {
    covering: { rating: "IN" },
    gutters: { rating: "IN", tabs: { defects: [{ cannedId: "discharge", included: true, location: "Rear" }] } },
    flashing: { rating: "IN" },
};
const getResult = (itemId: string) => results[itemId];
const levels = [{ id: "IN", label: "Inspected", abbreviation: "IN" }];
const categories = [{ id: "moderate", name: "Moderate" }, { id: "minor", name: "Minor" }];

function renderSearch(onJump = vi.fn()) {
    render(<MobileReportSearch sections={sections} getResult={getResult} onJump={onJump} ratingLevels={levels} defectCategories={categories} />);
    return onJump;
}
const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("MobileReportSearch tabs", () => {
    it("shows both tabs with their counts, Items first", () => {
        renderSearch();
        expect(tab(/Items/).getAttribute("aria-selected")).toBe("true");
        expect(within(tab(/Items/)).getByText("5")).toBeTruthy();
        expect(within(tab(/Defects/)).getByText("1")).toBeTruthy();
    });

    it("item rows say the rating, the finding and what is up next", () => {
        renderSearch();
        expect(screen.getByText("IN · 1 finding")).toBeTruthy(); // Gutters: rated, one included defect
        expect(screen.getAllByText("IN")).toHaveLength(2); // Roof Covering, Flashing
        expect(screen.getByText("Not rated · up next")).toBeTruthy(); // Chimney: first unfinished
        expect(screen.getByText("Not rated")).toBeTruthy(); // Siding: unfinished but not next
    });

    it("defect rows show the path with the location, grouped under their severity", () => {
        renderSearch();
        fireEvent.click(tab(/Defects/));
        expect(screen.getByText("Discharge at foundation")).toBeTruthy();
        expect(screen.getByText("Roof › Gutters & Downspouts · Rear")).toBeTruthy();
        expect(screen.getByText("Moderate defects")).toBeTruthy();
    });

    it("a result jumps to its item", () => {
        const onJump = renderSearch();
        fireEvent.click(screen.getByText("Chimney"));
        expect(onJump).toHaveBeenCalledWith("roof", "chimney");
    });

    it("the query narrows both tabs and the counts follow", () => {
        renderSearch();
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "gutters" } });
        expect(within(tab(/Items/)).getByText("1")).toBeTruthy();
        expect(within(tab(/Defects/)).getByText("1")).toBeTruthy();
    });

    it("says what was searched for when nothing matches", () => {
        renderSearch();
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
        expect(screen.getByText("Nothing in this report matches “zzz”.")).toBeTruthy();
        expect(within(tab(/Items/)).getByText("0")).toBeTruthy();
    });
});

describe("itemStatusText", () => {
    it("a defect rating counts as a finding even with no included defect", () => {
        const lv = [{ id: "DEF", label: "Defect", abbreviation: "DEF", isDefect: true }];
        expect(itemStatusText({ rating: "DEF" }, {}, lv, false)).toBe("DEF · 1 finding");
    });
    it("an item finished with a value and no rating reads as nothing, not as Not rated", () => {
        expect(itemStatusText({ value: "x" }, {}, levels, false)).toBe("");
    });
});
