// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FindingsIndicator } from "./FindingsIndicator";

afterEach(cleanup);

/**
 * `F` reads as the fourth tile of IN / NI / NP / F, and pressing it is how an
 * inspector says "something is wrong here". What it must NEVER be is a rating
 * value — its lit state stays derived from the defects underneath, so the only
 * way to clear it is to remove them.
 */
describe("FindingsIndicator", () => {
    it("is a real control when it can be activated", () => {
        render(<FindingsIndicator active={false} onActivate={() => {}} />);
        expect(screen.getByRole("button")).toBeTruthy();
    });

    it("calls onActivate when pressed", () => {
        const onActivate = vi.fn();
        render(<FindingsIndicator active={false} onActivate={onActivate} />);
        fireEvent.click(screen.getByRole("button"));
        expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it("is inert with no handler — a live region, not a button", () => {
        render(<FindingsIndicator active={false} />);
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.getByTestId("findings-indicator").tagName.toLowerCase()).toBe("output");
    });

    it("fills with the bad token only while findings are present", () => {
        const { rerender } = render(<FindingsIndicator active onActivate={() => {}} />);
        const tile = screen.getByTestId("findings-indicator");
        expect(tile.getAttribute("data-active")).toBe("true");
        expect(tile.className).toContain("bg-ih-bad");

        rerender(<FindingsIndicator active={false} onActivate={() => {}} />);
        expect(screen.getByTestId("findings-indicator").className).not.toContain("bg-ih-bad");
    });

    // It does not toggle: pressing it opens the defects, and the state goes out
    // only when the last one is removed. aria-pressed would promise otherwise.
    it("does not claim toggle semantics", () => {
        render(<FindingsIndicator active onActivate={() => {}} />);
        expect(screen.getByRole("button").getAttribute("aria-pressed")).toBeNull();
    });

    // The 44px touch floor: this is tapped one-handed on a roof.
    it("keeps the rating row's touch-target geometry", () => {
        render(<FindingsIndicator active={false} onActivate={() => {}} />);
        expect(screen.getByTestId("findings-indicator").className).toContain("h-11");
    });
});
