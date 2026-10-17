// @vitest-environment happy-dom
/**
 * Each photo sync mode gates the drain. The control is `auto`: a gate that
 * blocks everything passes "does not upload" for free, so the upload that
 * must happen is asserted first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type * as Y from "yjs";

import { SYNC_NOW_EVENT, PHOTO_SYNC_MODE_KEY, gateDrain } from "~/lib/collab/photo-sync-mode";
import { useMediaDrain } from "./useMediaDrain";

const drainMediaQueue = vi.fn(() => Promise.resolve({ uploaded: 0, failed: 0 }));
vi.mock("~/lib/collab/media-upload-queue", () => ({
    drainMediaQueue: (...a: unknown[]) => (drainMediaQueue as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("~/lib/collab/media-pending-store", () => ({
    listPendingMedia: () => Promise.resolve([{ pendingId: "p1" }, { pendingId: "p2" }]),
}));
const pushToast = vi.fn();
vi.mock("~/hooks/useToast", () => ({ pushToast: (t: unknown) => pushToast(t) }));

const doc = {} as Y.Doc;

function setConnectionType(type: string | undefined): void {
    Object.defineProperty(navigator, "connection", { value: type === undefined ? undefined : { type }, configurable: true });
}

async function trigger(): Promise<void> {
    const { result } = renderHook(() => useMediaDrain("i1", doc));
    await act(async () => {
        result.current.drain();
        await Promise.resolve();
        await Promise.resolve();
    });
}

beforeEach(() => {
    drainMediaQueue.mockClear();
    pushToast.mockClear();
    localStorage.clear();
    setConnectionType(undefined);
});
afterEach(() => setConnectionType(undefined));

describe("photo sync mode gates the drain", () => {
    it("auto uploads whenever triggered", async () => {
        await trigger();
        expect(drainMediaQueue).toHaveBeenCalledTimes(1);
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("prompt holds the upload and asks once", async () => {
        localStorage.setItem(PHOTO_SYNC_MODE_KEY, "prompt");
        const { result } = renderHook(() => useMediaDrain("i1", doc));
        await act(async () => {
            result.current.drain();
            result.current.drain();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(drainMediaQueue).not.toHaveBeenCalled();
        expect(pushToast).toHaveBeenCalledTimes(1);
    });

    it("the toast action and the pill event both force the upload", async () => {
        localStorage.setItem(PHOTO_SYNC_MODE_KEY, "prompt");
        const { result } = renderHook(() => useMediaDrain("i1", doc));
        await act(async () => {
            result.current.drain();
            await Promise.resolve();
            await Promise.resolve();
        });
        (pushToast.mock.calls[0]?.[0] as { onAction: () => void }).onAction();
        expect(drainMediaQueue).toHaveBeenCalledTimes(1);

        act(() => { window.dispatchEvent(new Event(SYNC_NOW_EVENT)); });
        expect(drainMediaQueue).toHaveBeenCalledTimes(2);
    });

    it("wifi uploads on wi-fi", async () => {
        localStorage.setItem(PHOTO_SYNC_MODE_KEY, "wifi");
        setConnectionType("wifi");
        await trigger();
        expect(drainMediaQueue).toHaveBeenCalledTimes(1);
    });

    it("wifi holds quietly on known cellular", async () => {
        localStorage.setItem(PHOTO_SYNC_MODE_KEY, "wifi");
        setConnectionType("cellular");
        await trigger();
        expect(drainMediaQueue).not.toHaveBeenCalled();
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("wifi falls back to asking where the type is unknown (iOS Safari)", async () => {
        localStorage.setItem(PHOTO_SYNC_MODE_KEY, "wifi");
        setConnectionType(undefined);
        await trigger();
        expect(drainMediaQueue).not.toHaveBeenCalled();
        expect(pushToast).toHaveBeenCalledTimes(1);
    });
});

describe("gateDrain", () => {
    it("lets a manual sync through in every mode", () => {
        for (const mode of ["auto", "prompt", "wifi"] as const) {
            expect(gateDrain(mode, "cellular", true)).toBe("go");
        }
    });
    it("treats ethernet as wi-fi and 'unknown' as unreadable", () => {
        expect(gateDrain("wifi", "ethernet", false)).toBe("go");
        expect(gateDrain("wifi", "unknown", false)).toBe("ask");
    });
});
