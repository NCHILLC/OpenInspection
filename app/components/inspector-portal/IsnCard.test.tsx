// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
    busy: false,
    result: undefined as { ok: boolean; error?: string } | undefined,
    submit: vi.fn(),
    load: vi.fn(),
}));
vi.mock("react-router", () => ({ useFetcher: () => ({ data: { orderNumber: "146" }, load: state.load }) }));
vi.mock("~/hooks/useGuardedSubmit", () => ({ useGuardedSubmit: () => ({ busy: state.busy, submit: state.submit, fetcher: { data: state.result } }) }));
import { IsnCard } from "./IsnCard";

beforeEach(() => { state.busy = false; state.result = undefined; state.submit.mockClear(); state.load.mockClear(); });
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
    it("shows the returned failure so the user can act on it", () => {
        state.result = { ok: false, error: "ISN intake is off" };
        render(<IsnCard inspectionId="inspection-1" />);
        expect(screen.getByRole("status")).toHaveTextContent("ISN intake is off");
    });
});
