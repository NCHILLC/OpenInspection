// @vitest-environment happy-dom
/**
 * Canvas X1: the banner under the app bar and the "Offline · n waiting" readout
 * in the bottom bar both come from the same two facts (phone network, local
 * queue) plus the live-socket status. A healthy session shows no banner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SYNC_NOW_EVENT } from "~/lib/collab/photo-sync-mode";
import { MobileOfflineBanner } from "./MobileOfflineBanner";
import { MobileSyncPill } from "./MobileSyncPill";

let queued: Array<{ pendingId: string }> = [];
vi.mock("~/lib/collab/media-pending-store", () => ({
    listPendingMedia: () => Promise.resolve(queued),
}));

let onLine = true;
const setOnLine = (v: boolean): void => {
    onLine = v;
    act(() => {
        window.dispatchEvent(new Event(v ? "online" : "offline"));
    });
};
const advance = async (ms: number): Promise<void> => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
};
const banner = (): HTMLElement | null => screen.queryByTestId("mobile-offline-banner");

beforeEach(() => {
    vi.useFakeTimers();
    onLine = true;
    queued = [];
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => onLine);
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("MobileOfflineBanner", () => {
    it("is absent while everything is healthy", async () => {
        render(<MobileOfflineBanner inspectionId="i1" connection="connected" />);
        await advance(3100);
        expect(banner()).toBeNull();
    });

    it("offline: says nothing is lost, counts the photos on the phone, offers Retry", async () => {
        queued = [{ pendingId: "p1" }, { pendingId: "p2" }];
        onLine = false;
        render(<MobileOfflineBanner inspectionId="i1" />);
        await advance(3100);
        expect(banner()?.getAttribute("data-banner-state")).toBe("offline");
        expect(screen.getByText("No connection")).toBeTruthy();
        expect(screen.getByText("Ratings and 2 photos are saved on this phone. They upload when you reconnect.")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });

    it("offline with an empty queue talks about ratings only", async () => {
        onLine = false;
        render(<MobileOfflineBanner inspectionId="i1" />);
        await advance(3100);
        expect(screen.getByText("Ratings are saved on this phone. They upload when you reconnect.")).toBeTruthy();
    });

    it("Retry re-checks the network and, once the phone is back, asks for a sync", async () => {
        onLine = false;
        const heard = vi.fn();
        window.addEventListener(SYNC_NOW_EVENT, heard);
        render(<MobileOfflineBanner inspectionId="i1" />);
        await advance(3100);
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(heard).not.toHaveBeenCalled(); // still offline: nothing to flush
        expect(banner()?.getAttribute("data-banner-state")).toBe("offline");

        onLine = true; // the online event was missed; Retry still notices
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(heard).toHaveBeenCalledTimes(1);
        expect(banner()?.getAttribute("data-banner-state")).not.toBe("offline");
        window.removeEventListener(SYNC_NOW_EVENT, heard);
    });

    it("reads Reconnecting while the phone has a network but the socket is down", async () => {
        render(<MobileOfflineBanner inspectionId="i1" connection="reconnecting" />);
        await advance(3100);
        expect(banner()?.getAttribute("data-banner-state")).toBe("reconnecting");
        expect(screen.getByText("Reconnecting…")).toBeTruthy();
        expect(screen.getByText("Keep working. Nothing is lost.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it("says All synced briefly once the queue drains after being offline, then goes away", async () => {
        queued = [{ pendingId: "p1" }];
        onLine = false;
        const { rerender } = render(<MobileOfflineBanner inspectionId="i1" connection="reconnecting" />);
        await advance(3100);
        setOnLine(true);
        rerender(<MobileOfflineBanner inspectionId="i1" connection="connected" />);
        await advance(3100);
        expect(banner()).toBeNull(); // back online, but a photo is still uploading

        queued = [];
        await advance(3100);
        expect(banner()?.getAttribute("data-banner-state")).toBe("synced");
        expect(screen.getByText("All synced")).toBeTruthy();

        await advance(4100);
        expect(banner()).toBeNull();
    });
});

describe("bottom-bar readout while offline", () => {
    it("reads Offline · n waiting", async () => {
        queued = [{ pendingId: "p1" }, { pendingId: "p2" }, { pendingId: "p3" }];
        onLine = false;
        render(<MobileSyncPill inspectionId="i1" />);
        await advance(3100);
        const pill = screen.getByTestId("mobile-sync-pill");
        expect(pill.getAttribute("data-sync-state")).toBe("offline");
        expect(pill.textContent).toBe("Offline · 3 waiting");
    });
});
