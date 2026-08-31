// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LimitationsPanel } from "./LimitationsPanel";

afterEach(cleanup);

const entry = (over: Partial<{ id: string; title: string; comment: string; included: boolean }> = {}) => ({
    id: "l1", title: "No access", comment: "", included: true, ...over,
});

describe("LimitationsPanel", () => {
    it("records a tapped reason", () => {
        const onAdd = vi.fn();
        render(<LimitationsPanel entries={[]} onAdd={onAdd} onToggle={() => {}} />);
        fireEvent.click(screen.getByRole("button", { name: "No access" }));
        expect(onAdd).toHaveBeenCalledWith("No access");
    });

    it("records a typed reason and clears the box", () => {
        const onAdd = vi.fn();
        render(<LimitationsPanel entries={[]} onAdd={onAdd} onToggle={() => {}} />);
        const box = screen.getByLabelText("Limitation reason") as HTMLInputElement;
        fireEvent.change(box, { target: { value: "  Owner declined  " } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onAdd).toHaveBeenCalledWith("Owner declined");
        expect(box.value).toBe("");
    });

    it("will not record an empty reason", () => {
        const onAdd = vi.fn();
        render(<LimitationsPanel entries={[]} onAdd={onAdd} onToggle={() => {}} />);
        const box = screen.getByLabelText("Limitation reason");
        fireEvent.change(box, { target: { value: "   " } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onAdd).not.toHaveBeenCalled();
    });

    it("warns while a required reason is missing", () => {
        render(<LimitationsPanel entries={[]} onAdd={() => {}} onToggle={() => {}} required />);
        expect(screen.getByTestId("limitation-required")).toBeTruthy();
    });

    // The warning is about the ANSWER being unexplained, so it must go the
    // moment a reason exists — not linger and train inspectors to ignore it.
    it("drops the warning once a reason is recorded", () => {
        render(<LimitationsPanel entries={[entry()]} onAdd={() => {}} onToggle={() => {}} required />);
        expect(screen.queryByTestId("limitation-required")).toBeNull();
    });

    // An excluded entry is not a stated reason, so the requirement stands.
    it("keeps warning when the only reason is excluded", () => {
        render(<LimitationsPanel entries={[entry({ included: false })]} onAdd={() => {}} onToggle={() => {}} required />);
        expect(screen.getByTestId("limitation-required")).toBeTruthy();
    });

    it("says nothing when no reason is required", () => {
        render(<LimitationsPanel entries={[]} onAdd={() => {}} onToggle={() => {}} />);
        expect(screen.queryByTestId("limitation-required")).toBeNull();
    });

    it("toggles a recorded reason off", () => {
        const onToggle = vi.fn();
        render(<LimitationsPanel entries={[entry()]} onAdd={() => {}} onToggle={onToggle} />);
        fireEvent.click(screen.getByRole("checkbox"));
        expect(onToggle).toHaveBeenCalledWith("l1", false);
    });
});
