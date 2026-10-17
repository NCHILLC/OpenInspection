// @vitest-environment happy-dom
/**
 * With a hold-back sync mode and photos waiting, the pill turns into the "sync
 * now" control; in auto mode the same queue reads as plain uploading.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PHOTO_SYNC_MODE_KEY, SYNC_NOW_EVENT } from "~/lib/collab/photo-sync-mode";
import { MobileSyncPill } from "./MobileSyncPill";

vi.mock("~/lib/collab/media-pending-store", () => ({
    listPendingMedia: () => Promise.resolve([{ pendingId: "p1" }, { pendingId: "p2" }]),
}));

const state = (): string | null => screen.getByTestId("mobile-sync-pill").getAttribute("data-sync-state");

beforeEach(() => localStorage.clear());

describe("MobileSyncPill with queued photos", () => {
    it("reads uploading in auto mode", async () => {
        render(<MobileSyncPill inspectionId="i1" />);
        await waitFor(() => expect(state()).toBe("uploading"));
    });

    it("reads held in prompt mode and tapping it asks for a sync", async () => {
        localStorage.setItem(PHOTO_SYNC_MODE_KEY, "prompt");
        const heard = vi.fn();
        window.addEventListener(SYNC_NOW_EVENT, heard);
        render(<MobileSyncPill inspectionId="i1" />);
        await waitFor(() => expect(state()).toBe("held"));
        fireEvent.click(screen.getByTestId("mobile-sync-pill"));
        expect(heard).toHaveBeenCalledTimes(1);
        window.removeEventListener(SYNC_NOW_EVENT, heard);
    });
});
