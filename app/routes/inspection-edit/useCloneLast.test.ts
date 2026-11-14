// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { m } from "~/paraglide/messages";
import { useCloneLast } from "./useCloneLast";

const pushToast = vi.fn();
vi.mock("~/hooks/useToast", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

/**
 * Clone last copies the nearest earlier RATED item in the section. When there is
 * none, the tap used to do nothing at all: no change on screen and no message, so
 * the inspector could not tell a miss from a broken button.
 */

const state = {
    activeItemId: "i2",
    currentSection: { id: "s1" },
    currentSectionItems: [{ id: "i1" }, { id: "i2" }],
};

function setup(cloneLast: (...a: unknown[]) => boolean, s: Record<string, unknown> = state) {
    const { result } = renderHook(() => useCloneLast({ state: s as never, findings: { cloneLast } as never }));
    return result.current;
}

beforeEach(() => { pushToast.mockClear(); });

describe("useCloneLast", () => {
    it("tells the inspector when there is no earlier rated item to copy", () => {
        setup(() => false)("rating_notes");
        expect(pushToast).toHaveBeenCalledTimes(1);
        expect(pushToast.mock.calls[0][0]).toMatchObject({ message: m.editor_clone_last_none() });
    });

    it("stays quiet when the copy worked", () => {
        const cloneLast = vi.fn(() => true);
        setup(cloneLast)("rating");
        expect(cloneLast).toHaveBeenCalledWith("s1", "i2", state.currentSectionItems, "rating");
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("does nothing, silently, when no item is selected", () => {
        const cloneLast = vi.fn(() => false);
        setup(cloneLast, { ...state, activeItemId: null })("rating");
        expect(cloneLast).not.toHaveBeenCalled();
        expect(pushToast).not.toHaveBeenCalled();
    });
});
