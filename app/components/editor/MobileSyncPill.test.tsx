// @vitest-environment happy-dom
/**
 * The pill answers "is my work safe?", so the one reading it must never give is
 * "Synced" while the server cannot be reached. `navigator.onLine` stays true in
 * exactly that case (the phone has a network; this server does not answer on
 * it), which is how the pill came to say "Synced" over an edit that was on the
 * phone only.
 *
 * The control matters: "does not say Synced" passes for free on a pill that
 * never says it, so the connected case is asserted first.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { MobileSyncPill } from "./MobileSyncPill";

vi.mock("~/lib/collab/media-pending-store", () => ({
    listPendingMedia: () => Promise.resolve([]),
}));

const state = (): string | null => screen.getByTestId("mobile-sync-pill").getAttribute("data-sync-state");

describe("MobileSyncPill", () => {
    it("reads synced only while the server connection is live", () => {
        const { rerender } = render(<MobileSyncPill inspectionId="i1" connection="connected" />);
        expect(state()).toBe("synced");

        rerender(<MobileSyncPill inspectionId="i1" connection="reconnecting" />);
        expect(state()).toBe("reconnecting");

        rerender(<MobileSyncPill inspectionId="i1" connection="connecting" />);
        expect(state()).toBe("connecting");
    });
});
