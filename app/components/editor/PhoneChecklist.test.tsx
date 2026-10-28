// @vitest-environment happy-dom
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { PhoneChecklist, type PhoneChecklistProps } from "./PhoneChecklist";
import { FALLBACK_RATING_LEVELS } from "~/lib/rating-levels";

vi.mock("~/lib/haptics", () => ({ haptic: () => {}, HAPTIC_TAP: 0 }));
const toasts: Array<{ onAction?: () => void }> = [];
vi.mock("~/hooks/useToast", () => ({ pushToast: (t: { onAction?: () => void }) => toasts.push(t) }));

const items = [
    { id: "roof", label: "Roof Covering", type: "rich", tabs: { defects: [{ id: "shingle", title: "Damaged shingles", default: true, comment: "", category: "moderate", location: "Rear", photos: [] }] } },
    { id: "chimney", label: "Chimney", type: "rich" },
];

function setup(initial: Record<string, Record<string, unknown>> = {}, overrides: Partial<PhoneChecklistProps> = {}) {
    toasts.length = 0;
    const onSelect = vi.fn();
    const onAddPhoto = vi.fn();
    const onMoveItem = vi.fn();
    function Harness() {
        const [results, setResults] = useState(initial);
        return <PhoneChecklist mode="fill" sectionId="s" items={items} allItems={items} activeItemId={null}
            ratingLevels={FALLBACK_RATING_LEVELS} defectCategories={[{ id: "moderate", name: "Moderate" }]}
            onSelect={onSelect} onAddPhoto={onAddPhoto} onMoveItem={onMoveItem}
            findings={{
                getResult: id => results[id] ?? {},
                setRating: (_s, id, rating) => setResults(prev => ({ ...prev, [id]: { ...prev[id], rating } })),
                addCustomLimitation: vi.fn(),
            }} {...overrides} />;
    }
    const view = render(<Harness />);
    return { ...view, onSelect, onAddPhoto };
}

describe("phone checklist through the shared ItemList", () => {
    it("shows live controls on every row; rating in place updates progress and the next item", () => {
        setup();
        const row = screen.getByRole("article", { name: "Roof Covering" });
        const group = within(row).getByRole("radiogroup", { name: "Rate Roof Covering" });
        expect(within(group).getAllByRole("radio")).toHaveLength(3);
        expect(within(row).getByText("Up next")).toBeTruthy();
        fireEvent.click(within(group).getByRole("radio", { name: "Inspected" }));
        expect(within(group).getByRole("radio", { name: "Inspected" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
        expect(within(screen.getByRole("article", { name: "Chimney" })).getByText("Up next")).toBeTruthy();
        act(() => toasts[0].onAction?.());
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
        expect(within(row).getByText("Up next")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /Open details — Chimney/ }));
    });

    it("keeps rating controls when the inspection has no explicit rating levels", () => {
        setup({}, { ratingLevels: [] });
        expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
        expect(screen.getAllByRole("radio")).toHaveLength(6);
    });

    it("counts completed typed fields without inventing ratings for them", () => {
        const typed = [{ id: "roof", label: "Roof age", type: "number" }, { id: "chimney", label: "Notes", type: "text" }];
        setup({ roof: { value: 0 } }, { items: typed, allItems: typed });
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
        expect(screen.queryAllByRole("radiogroup")).toHaveLength(0);
        expect(within(screen.getByRole("article", { name: "Notes" })).getByText("Up next")).toBeTruthy();
    });

    it("counts included findings and their photos, including queued attachments, with severity and location", () => {
        setup({ roof: {
            rating: "Inspected", photos: [{ key: "item-photo" }],
            tabs: { defects: [{ cannedId: "shingle", photos: [{ key: "defect-photo" }], category: "moderate", location: "Rear" }] },
            customComments: { defects: [
                { id: "custom", title: "Leak", included: true, location: "Front", photos: [{ key: "", pendingId: "pending" }] },
                { id: "off", title: "Excluded", included: false, photos: [{ key: "excluded" }] },
            ] },
        } });
        const summary = screen.getByTestId("checklist-summary");
        expect(summary.textContent).toContain("2 findings");
        expect(summary.textContent).toContain("3 photos");
        expect(screen.getByText("Damaged shingles · Moderate · Rear")).toBeTruthy();
        expect(screen.queryByText("Excluded")).toBeNull();
        const row = screen.getByRole("article", { name: "Roof Covering" });
        expect(within(row).getByTestId("findings-indicator")).toHaveAttribute("data-active", "true");
        expect(within(row).getByRole("button", { name: /Add photo/ }).textContent).toContain("3");
    });

    it("targets the tapped row's camera without navigating or rating another item", () => {
        const { onAddPhoto, onSelect } = setup();
        fireEvent.click(screen.getByRole("button", { name: "Add photo — Chimney" }));
        expect(onAddPhoto).toHaveBeenCalledWith("chimney");
        expect(onSelect).not.toHaveBeenCalled();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    });

    it("opens findings independently of the rating and preserves an explicit Not Inspected answer", () => {
        const { onSelect } = setup({ roof: { rating: "Not Inspected" } });
        const row = screen.getByRole("article", { name: "Roof Covering" });
        fireEvent.click(within(row).getByTestId("findings-indicator"));
        expect(onSelect).toHaveBeenCalledWith("roof");
        expect(within(row).getByRole("radio", { name: "Not Inspected" })).toHaveAttribute("aria-checked", "true");
        expect(within(row).getByRole("radiogroup").querySelectorAll('[role="radio"]')).toHaveLength(3);
    });

    it("keeps the existing structural list available explicitly, then returns to inspection controls", () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: "Edit Items" }));
        expect(screen.queryAllByRole("radiogroup")).toHaveLength(0);
        expect(screen.getByRole("button", { name: "Edit Roof Covering" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
    });
});
