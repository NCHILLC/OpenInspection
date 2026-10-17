import { afterEach, describe, expect, it, vi } from "vitest";
import { openNewInspection } from "./wizard-submit";
import * as toast from "~/hooks/useToast";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("openNewInspection", () => {
  it("navigates to the wizard when online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const navigate = vi.fn();
    const push = vi.spyOn(toast, "pushToast").mockImplementation(() => {});
    openNewInspection(navigate);
    expect(navigate).toHaveBeenCalledWith("/inspections/new");
    expect(push).not.toHaveBeenCalled();
  });

  it("stays put and explains itself when offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    const navigate = vi.fn();
    const push = vi.spyOn(toast, "pushToast").mockImplementation(() => {});
    openNewInspection(navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
  });
});
