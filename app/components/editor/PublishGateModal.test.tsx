// @vitest-environment happy-dom
/**
 * The desktop publish gate names missing temperature and weather. With those as
 * the only gap `ready` is false and `blockingDefects` is empty, so the title
 * must not count zero and the reader must have a way to the details form.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { PublishGateModal } from "./PublishGateModal";
import type { PublishReadiness } from "../../lib/types";

afterEach(cleanup);

function setup(readiness: PublishReadiness, over: { onOpenDetails?: () => void } = {}) {
    const props = { open: true, readiness, onClose: vi.fn(), onJump: vi.fn(), ...over };
    return { props, ...render(<PublishGateModal {...props} />) };
}

describe("PublishGateModal missing facts", () => {
    it("counts the missing facts in the title and opens the details form", () => {
        const onOpenDetails = vi.fn();
        setup({ ready: false, blockingDefects: [], warningDefects: [], missingFacts: ["temperature", "weather"] }, { onOpenDetails });
        expect(screen.getByRole("heading").textContent).toContain("2");
        expect(screen.getByText("Record the temperature and weather")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: /Open details/ }));
        expect(onOpenDetails).toHaveBeenCalledTimes(1);
    });

    it("names only the weather when that is the only gap", () => {
        setup({ ready: false, blockingDefects: [], warningDefects: [], missingFacts: ["weather"] });
        expect(screen.getByText("Record the weather")).toBeTruthy();
        expect(screen.getByRole("heading").textContent).toContain("1");
    });
});
