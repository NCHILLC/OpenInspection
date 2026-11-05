// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
    busy: false,
    result: undefined as { ok: boolean; error?: string } | undefined,
    submit: vi.fn(),
    load: vi.fn(),
    hookCalls: 0,
}));
vi.mock("react-router", () => ({ useFetcher: () => ({ data: { orderNumber: "146" }, load: state.load }) }));
vi.mock("~/hooks/useGuardedSubmit", () => ({ useGuardedSubmit: () => {
    const refresh = state.hookCalls++ % 2 === 0;
    return { busy: refresh && state.busy, submit: state.submit, fetcher: { data: refresh ? state.result : undefined } };
} }));
import { IsnCard } from "./IsnCard";

beforeEach(() => { state.hookCalls = 0; state.busy = false; state.result = undefined; state.submit.mockClear(); state.load.mockClear(); });
afterEach(cleanup);
describe("ISN card refresh", () => {
    it("refreshes the linked inspection through the guarded resource action", () => {
        render(<IsnCard inspectionId="inspection-1" />);
        fireEvent.click(screen.getByRole("button", { name: "Refresh from ISN" }));
        expect(state.submit).toHaveBeenCalledWith({ inspectionId: "inspection-1" }, { method: "post", action: "/resources/isn-card" });
    });
    it("disables refresh while the request is running", () => {
        state.busy = true;
        render(<IsnCard inspectionId="inspection-1" />);
        expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    });
    it("keeps applying the mapped template separate from refreshing ISN facts", () => {
        render(<IsnCard inspectionId="inspection-1" />);
        fireEvent.click(screen.getByRole("button", { name: "Apply mapped template" }));
        expect(state.submit).toHaveBeenCalledWith({ inspectionId: "inspection-1", intent: "apply-template" }, { method: "post", action: "/resources/isn-card" });
    });
    it("shows the returned failure so the user can act on it", () => {
        state.result = { ok: false, error: "ISN intake is off" };
        render(<IsnCard inspectionId="inspection-1" />);
        expect(screen.getByRole("status")).toHaveTextContent("ISN intake is off");
    });
});
