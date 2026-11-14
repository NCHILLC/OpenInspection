// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloneLastButton } from "./CloneLastButton";

/**
 * The collab clone copies the rating and the notes and nothing else, so an
 * "Everything" choice promised more than it did. The menu offers only the two
 * scopes that mean what they say.
 */
describe("CloneLastButton menu", () => {
    it("offers Rating only and Rating + Notes, and no Everything", () => {
        render(<CloneLastButton defaultScope="rating_notes" onClone={() => {}} />);
        fireEvent.click(screen.getByRole("button"));
        const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.replace("✓", "").trim());
        expect(items).toEqual(["Rating only", "Rating + Notes"]);
    });

    it("passes the picked scope to onClone", () => {
        const onClone = vi.fn();
        render(<CloneLastButton defaultScope="rating_notes" onClone={onClone} />);
        fireEvent.click(screen.getByRole("button"));
        fireEvent.click(screen.getByText("Rating only"));
        expect(onClone).toHaveBeenCalledWith("rating");
    });
});
