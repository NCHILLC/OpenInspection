// @vitest-environment happy-dom
/**
 * The phone checklist rates rows inline. Three promises: the buttons are the
 * template's own levels, "Up next" sits on the first unrated row, and a tap
 * can be undone back to exactly what was there (including "not rated").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { checklistRowRating } from "./ChecklistRowRating";

const toasts: Array<{ message: string; onAction?: () => void }> = [];
vi.mock("~/hooks/useToast", () => ({ pushToast: (t: { message: string; onAction?: () => void }) => toasts.push(t) }));
vi.mock("~/lib/haptics", () => ({ haptic: () => {}, HAPTIC_TAP: 0 }));

const LEVELS = [
    { id: "Satisfactory", label: "Satisfactory", abbreviation: "SAT", severity: "good" },
    { id: "Defect", label: "Defect", abbreviation: "DEF", severity: "significant" },
];
const ITEMS = [{ id: "a", label: "Chimney" }, { id: "b", label: "Gutters" }];

function setup(ratings: Record<string, string>, levels = LEVELS, limitations: Record<string, unknown[]> = {}) {
    const setRating = vi.fn();
    const addCustomLimitation = vi.fn();
    const getResult = (id: string) => ({ ...(ratings[id] ? { rating: ratings[id] } : {}), customComments: { limitations: limitations[id] ?? [] } });
    const findings = { getResult, setRating, addCustomLimitation };
    const footer = checklistRowRating("s1", ITEMS, levels, findings as never);
    const view = render(<>{footer("a")}{footer("b")}</>);
    return Object.assign(setRating, { addCustomLimitation, view });
}

const NI_LEVELS = [...LEVELS, { id: "NI", label: "Not Inspected", abbreviation: "NI", severity: "minor", isDefect: false }];

beforeEach(() => { toasts.length = 0; });

describe("checklistRowRating", () => {
    it("tags the first unrated row as Up next, and only that one", () => {
        setup({ a: "Satisfactory" });
        expect(screen.getAllByText("Up next")).toHaveLength(1);
        const row = screen.getByText("Up next").parentElement as HTMLElement;
        expect(within(row).getByRole("radiogroup").getAttribute("aria-label")).toBe("Rate Gutters");
    });

    it("renders the template's levels, not a fixed IN/NI/NP set", () => {
        setup({});
        const group = screen.getByRole("radiogroup", { name: "Rate Chimney" });
        expect(group.querySelectorAll('[role="radio"]')).toHaveLength(2);
        expect(group.textContent).toContain("SAT");
    });

    it("rates in place, and Undo restores the prior state (unrated)", () => {
        const setRating = setup({});
        const group = screen.getByRole("radiogroup", { name: "Rate Chimney" });
        fireEvent.click(group.querySelectorAll('[role="radio"]')[1]);
        expect(setRating).toHaveBeenLastCalledWith("s1", "a", "Defect");
        expect(toasts[0].message).toBe("Rated as Defect.");
        toasts[0].onAction?.();
        expect(setRating).toHaveBeenLastCalledWith("s1", "a", null);
    });

    it("does nothing when the tap repeats the current rating", () => {
        const setRating = setup({ a: "Satisfactory" });
        fireEvent.click(screen.getByRole("radiogroup", { name: "Rate Chimney" }).querySelectorAll('[role="radio"]')[0]);
        expect(setRating).not.toHaveBeenCalled();
        expect(toasts).toHaveLength(0);
    });

    it("a Not Inspected tap opens the reason sheet; a chip records the reason and closes it", () => {
        const { addCustomLimitation } = setup({}, NI_LEVELS);
        fireEvent.click(screen.getByRole("radiogroup", { name: "Rate Chimney" }).querySelectorAll('[role="radio"]')[2]);
        const sheet = screen.getByRole("dialog", { name: "Why wasn't Chimney inspected?" });
        fireEvent.click(within(sheet).getAllByRole("button")[0]);
        expect(addCustomLimitation).toHaveBeenCalledWith("s1", "a", expect.objectContaining({ included: true }));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("an NI row without a reason keeps the prompt; one with a reason does not", () => {
        setup({ a: "NI", b: "NI" }, NI_LEVELS, { b: [{ id: "x", title: "Locked", comment: "", included: true }] });
        expect(screen.getAllByText("Not inspected needs a reason")).toHaveLength(1);
        fireEvent.click(screen.getByText("Add reason"));
        expect(screen.getByRole("dialog", { name: "Why wasn't Chimney inspected?" })).toBeTruthy();
    });

    it("rating anything else never asks for a reason", () => {
        setup({}, NI_LEVELS);
        fireEvent.click(screen.getByRole("radiogroup", { name: "Rate Chimney" }).querySelectorAll('[role="radio"]')[1]);
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});
