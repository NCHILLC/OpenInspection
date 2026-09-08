// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
import { useEditorPhotoUpload } from "./useEditorPhotoUpload";

vi.mock("~/components/media-studio/preprocessImage", () => ({
    preprocessImage: (f: File) => Promise.resolve(f),
}));
const pushToast = vi.fn();
vi.mock("~/hooks/useToast", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

const enqueueMedia = vi.fn((_rec: unknown) => Promise.resolve("id"));
const appendPendingPhoto = vi.fn((..._args: unknown[]) => {});
const appendPendingPhotoToDefect = vi.fn((..._args: unknown[]) => {});
vi.mock("~/lib/collab/media-upload-queue", () => ({ enqueueMedia: (r: unknown) => enqueueMedia(r) }));
vi.mock("~/lib/collab/results-binding", () => ({
    appendPendingPhoto: (...a: unknown[]) => appendPendingPhoto(...a),
}));
vi.mock("~/lib/collab/defect-photo-binding", () => ({
    appendPendingPhotoToDefect: (...a: unknown[]) => appendPendingPhotoToDefect(...a),
}));

/**
 * Where a picked photo LANDS.
 *
 * `ItemEntry.photos` and `DefectState.photos` are different stores that look
 * identical on screen, so a photo sent to the wrong one is invisible in the
 * editor and wrong in the report — it shows on a finding the inspector did not
 * put it on, and is missing from the item they did.
 *
 * The target is armed when a per-defect chip is tapped and read when the picker
 * finally fires, which is an unbounded gap: the inspector can cancel, wander
 * off, and add a photo somewhere else entirely in between. These cover that gap.
 */

const submit = vi.fn();
const drain = vi.fn();
const uploadFetcher = { state: "idle", data: undefined, submit };
const openPhotoStudio = vi.fn();
const itemGalleryPhotos = vi.fn((_itemId: string): unknown[] => []);
const defectPhotoOps = { galleryPhotos: vi.fn((): unknown[] => []), setStudio: vi.fn() };

function makeState() {
    return {
        activeItemId: "item-1",
        inspection: { id: "insp-1" },
        cameraItemId: "item-1",
        currentSection: { id: "sec-1" },
        sectionIdForItem: () => "sec-1",
    } as never;
}

/** `collabDoc: null` keeps a case on the FETCHER path, which is where the
 *  defect-target assertions live. Pass a doc to exercise the queue path.
 *
 *  Fetcher submissions serialise (see "serialises a burst" below), so a test
 *  that submits twice has to let the first one finish in between — which is
 *  what `settle()` models: submitting, then back to idle. */
function setup(collabDoc: unknown = null) {
    const fetcher = { state: "idle", data: undefined, submit };
    const view = renderHook(() =>
        useEditorPhotoUpload({
            state: makeState(),
            findings: { addPhotoToItem: vi.fn(), addPhotoToDefect: vi.fn() } as never,
            uploadFetcher: fetcher as never,
            collabDoc: collabDoc as never,
            activeUnitId: null,
            cameraInputRef: createRef<HTMLInputElement>(),
            libraryInputRef: createRef<HTMLInputElement>(),
            isMobile: false,
            setAddMediaChooser: vi.fn(),
            drain,
            itemGalleryPhotos: itemGalleryPhotos as never,
            openPhotoStudio,
            defectPhotoOps: defectPhotoOps as never,
        }),
    );
    const settle = async () => {
        fetcher.state = "submitting";
        await act(async () => view.rerender());
        fetcher.state = "idle";
        await act(async () => view.rerender());
    };
    return { ...view, fetcher, settle };
}

/** Drive handlePhotoUpload with one file and let its async body settle. */
async function pickAPhoto(handler: (e: never) => void) {
    const file = new File(["x"], "shingle.jpg", { type: "image/jpeg" });
    await act(async () => {
        handler({ target: { files: [file], value: "" } } as never);
        await Promise.resolve();
        await Promise.resolve();
    });
}

/** Drive one camera frame through the funnel and let its async body settle. */
async function shootAFrame(handler: (b: Blob) => void) {
    await act(async () => {
        handler(new Blob(["y"], { type: "image/jpeg" }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

/** What the submitted FormData says about where the photo goes. */
function lastTarget() {
    const fd = submit.mock.calls.at(-1)?.[0] as FormData | undefined;
    return {
        targetType: fd?.get("targetType") ?? null,
        customId: fd?.get("customId") ?? null,
    };
}

beforeEach(() => {
    submit.mockClear();
    drain.mockClear();
    enqueueMedia.mockClear();
    appendPendingPhoto.mockClear();
    appendPendingPhotoToDefect.mockClear();
    openPhotoStudio.mockClear();
    pushToast.mockClear();
    itemGalleryPhotos.mockReset().mockReturnValue([]);
    defectPhotoOps.galleryPhotos.mockReset().mockReturnValue([]);
    defectPhotoOps.setStudio.mockClear();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("useEditorPhotoUpload — the photo lands where the inspector aimed it", () => {
    it("sends a photo opened from the item to the item", async () => {
        const { result } = setup();
        act(() => result.current.openPickerForItem());
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(lastTarget()).toEqual({ targetType: null, customId: null });
    });

    it("sends a photo opened from a defect chip to that defect", async () => {
        const { result } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(lastTarget()).toEqual({ targetType: "defect", customId: "d1" });
    });

    // THE REGRESSION, and why opening the picker now IS setting the target.
    // Arming used to survive a cancelled picker, so the next item-level photo
    // silently attached to the defect the inspector had abandoned.
    it("does not send an item photo to a defect whose picker was abandoned", async () => {
        const { result } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        // ...inspector cancels: no photo arrives, nothing consumes the target.
        act(() => result.current.openPickerForItem());
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(lastTarget()).toEqual({ targetType: null, customId: null });
    });

    it("drops the target when the chooser is dismissed", async () => {
        const { result } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        act(() => result.current.clearPhotoTarget());
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(lastTarget()).toEqual({ targetType: null, customId: null });
    });

    // One tap, one photo: the target is consumed, not left armed for the next.
    it("does not reuse a defect target for a second photo", async () => {
        const { result, settle } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(lastTarget().targetType).toBe("defect");
        await settle();
        await pickAPhoto(result.current.handlePhotoUpload);
        await settle();
        expect(lastTarget()).toEqual({ targetType: null, customId: null });
    });

    /**
     * A capture session opened from a defect's chip belongs to that defect for
     * its WHOLE length — not just the first frame.
     *
     * This regressed when the in-app camera replaced `<input capture>`: the old
     * path ran through handlePhotoUpload, which read the armed target; the new
     * one cleared it and put every frame on the item. Reported from the field as
     * "photos for specific defects need to stay attached to them".
     */
    it("keeps every frame of a session on the defect it was opened from", async () => {
        const { result } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        await shootAFrame(result.current.handleCameraFrame);
        expect(lastTarget()).toEqual({ targetType: "defect", customId: "d1" });
        // The target survives the frame that consumed it: the session is one act.
        await shootAFrame(result.current.handleCameraFrame);
        expect(lastTarget()).toEqual({ targetType: "defect", customId: "d1" });
    });

    /**
     * ...and none of them is lost on the way. A fetcher aborts its in-flight
     * request when the same fetcher submits again, so three frames fired a few
     * hundred ms apart would land only the last one. They queue instead, one
     * released each time the fetcher returns to idle.
     */
    it("serialises a burst of defect frames instead of aborting them", async () => {
        const { result, fetcher, rerender } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));

        // Three shutter taps with nothing acknowledged in between.
        await shootAFrame(result.current.handleCameraFrame);
        fetcher.state = "submitting";
        await act(async () => rerender());
        await shootAFrame(result.current.handleCameraFrame);
        await shootAFrame(result.current.handleCameraFrame);
        expect(submit).toHaveBeenCalledTimes(1);

        // Each return to idle releases exactly one more.
        for (const expected of [2, 3]) {
            fetcher.state = "idle";
            await act(async () => rerender());
            expect(submit).toHaveBeenCalledTimes(expected);
            expect(lastTarget()).toEqual({ targetType: "defect", customId: "d1" });
            fetcher.state = "submitting";
            await act(async () => rerender());
        }
    });

    // ...and closing the camera disarms it, so the next item-level add is clean.
    it("drops the target when the camera closes", async () => {
        const { result, settle } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        await shootAFrame(result.current.handleCameraFrame);
        await settle();
        act(() => result.current.clearPhotoTarget());
        await pickAPhoto(result.current.handlePhotoUpload);
        await settle();
        expect(lastTarget()).toEqual({ targetType: null, customId: null });
    });
});

/**
 * The capture funnel: with a live doc, an ITEM photo goes to the offline queue
 * whether or not there is a network, and the drain does the upload.
 *
 * This is what lets the add control and the camera shutter stay live. On the old
 * fetcher path a second capture aborted the first, so both had to refuse taps
 * while one was in flight — the "tap +, nothing happens" report.
 */
describe("useEditorPhotoUpload — every item photo rides the queue", () => {
    const doc = {} as never;

    it("queues an item photo instead of posting it, even online", async () => {
        const { result } = setup(doc);
        act(() => result.current.openPickerForItem());
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(enqueueMedia).toHaveBeenCalledTimes(1);
        expect(appendPendingPhoto).toHaveBeenCalledTimes(1);
        expect(drain).toHaveBeenCalledTimes(1);
        expect(submit).not.toHaveBeenCalled();
    });

    it("queues every frame of a capture session, back to back", async () => {
        const { result } = setup(doc);
        await shootAFrame(result.current.handleCameraFrame);
        await shootAFrame(result.current.handleCameraFrame);
        await shootAFrame(result.current.handleCameraFrame);
        expect(enqueueMedia).toHaveBeenCalledTimes(3);
        expect(appendPendingPhoto).toHaveBeenCalledTimes(3);
        expect(submit).not.toHaveBeenCalled();
    });

    it("keeps queuing while the upload fetcher is busy", async () => {
        const busy = { ...uploadFetcher, state: "submitting" };
        const { result } = renderHook(() =>
            useEditorPhotoUpload({
                state: makeState(),
                findings: { addPhotoToItem: vi.fn(), addPhotoToDefect: vi.fn() } as never,
                uploadFetcher: busy as never,
                collabDoc: doc,
                activeUnitId: null,
                cameraInputRef: createRef<HTMLInputElement>(),
                libraryInputRef: createRef<HTMLInputElement>(),
                isMobile: false,
                setAddMediaChooser: vi.fn(),
                drain,
                itemGalleryPhotos: itemGalleryPhotos as never,
                openPhotoStudio,
                defectPhotoOps: defectPhotoOps as never,
            }),
        );
        await shootAFrame(result.current.handleCameraFrame);
        expect(enqueueMedia).toHaveBeenCalledTimes(1);
    });

    /**
     * The 2026-09-06 field-eval P0. A defect photo used to go straight to the
     * fetcher; offline that POST failed into the route error boundary, killed
     * the editor with "Something went wrong" and lost the photo. It now rides
     * the same queue as an item photo, tagged so the drain knows which array to
     * swap the real key into.
     */
    it("queues a defect-targeted photo, tagged with the defect", async () => {
        const { result } = setup(doc);
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(submit).not.toHaveBeenCalled();
        expect(enqueueMedia).toHaveBeenCalledTimes(1);
        expect(enqueueMedia.mock.calls[0]?.[0]).toMatchObject({
            defectTarget: { kind: "canned", id: "d1" },
        });
        expect(appendPendingPhotoToDefect).toHaveBeenCalledTimes(1);
        expect(appendPendingPhoto).not.toHaveBeenCalled();
    });

    // Three frames at one defect must produce three records, not one. The doc
    // append dedups by key, and every pending key is "" until the drain runs.
    it("queues every frame of a defect capture session", async () => {
        const { result } = setup(doc);
        act(() => result.current.openPickerForDefect({ kind: "custom", id: "c9" }));
        await shootAFrame(result.current.handleCameraFrame);
        await shootAFrame(result.current.handleCameraFrame);
        await shootAFrame(result.current.handleCameraFrame);
        expect(enqueueMedia).toHaveBeenCalledTimes(3);
        expect(appendPendingPhotoToDefect).toHaveBeenCalledTimes(3);
        const ids = appendPendingPhotoToDefect.mock.calls.map((c) => c[4]);
        expect(new Set(ids).size).toBe(3);
        expect(submit).not.toHaveBeenCalled();
    });

    // The one remaining fetcher case: no collab doc means nothing to enqueue into.
    it("still posts a defect-targeted photo when the doc is not live", async () => {
        const { result } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(enqueueMedia).not.toHaveBeenCalled();
        expect(lastTarget()).toEqual({ targetType: "defect", customId: "d1" });
    });
});

/**
 * Field eval P1 — shoot-to-annotate. `handleAnnotateNewest` opens the
 * annotator on exactly the last photo of whichever array the session shoots
 * into — the item's, or the defect's when the camera was opened from a chip —
 * and refuses only a shot that has nothing on the server yet.
 */
describe("useEditorPhotoUpload — shoot-to-annotate", () => {
    it("opens the annotator on the newest uploaded photo", async () => {
        itemGalleryPhotos.mockReturnValue([
            { key: "k0", photoIndex: 0, pending: false },
            { key: "k1", photoIndex: 1, pending: false, croppedKey: "k1-crop" },
        ]);
        const { result } = setup();
        act(() => result.current.handleAnnotateNewest());
        expect(openPhotoStudio).toHaveBeenCalledWith(
            expect.objectContaining({ key: "k1-crop", index: 1, total: 2 }),
        );
    });

    it("toasts instead of opening while the newest photo is still uploading", async () => {
        itemGalleryPhotos.mockReturnValue([{ key: "", photoIndex: 0, pending: true }]);
        const { result } = setup();
        act(() => result.current.handleAnnotateNewest());
        expect(openPhotoStudio).not.toHaveBeenCalled();
        expect(pushToast).toHaveBeenCalledTimes(1);
    });

    // Used to no-op here — a visible edit badge that did nothing for every
    // photo shot from a defect chip (2026-09-08 field eval).
    it("opens the DEFECT annotator for a defect-targeted session", async () => {
        itemGalleryPhotos.mockReturnValue([{ key: "item-k0", photoIndex: 0, pending: false }]);
        defectPhotoOps.galleryPhotos.mockReturnValue([
            { key: "d-k0", photoIndex: 0, pending: false },
            { key: "d-k1", photoIndex: 1, pending: false },
        ]);
        const { result } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        act(() => result.current.handleAnnotateNewest());
        expect(defectPhotoOps.galleryPhotos).toHaveBeenCalledWith("item-1", { kind: "canned", id: "d1" });
        expect(defectPhotoOps.setStudio).toHaveBeenCalledWith(
            expect.objectContaining({ target: { kind: "canned", id: "d1" }, photoIndex: 1, url: expect.stringContaining("d-k1") }),
        );
        expect(openPhotoStudio).not.toHaveBeenCalled();
    });

    it("no-ops when the item has no photos yet", async () => {
        const { result } = setup();
        act(() => result.current.handleAnnotateNewest());
        expect(openPhotoStudio).not.toHaveBeenCalled();
    });
});
