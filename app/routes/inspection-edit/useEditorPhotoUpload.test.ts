// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
import { useEditorPhotoUpload } from "./useEditorPhotoUpload";

vi.mock("~/components/media-studio/preprocessImage", () => ({
    preprocessImage: (f: File) => Promise.resolve(f),
}));
vi.mock("~/hooks/useToast", () => ({ pushToast: vi.fn() }));

const enqueueMedia = vi.fn((_rec: unknown) => Promise.resolve("id"));
const appendPendingPhoto = vi.fn((..._args: unknown[]) => {});
vi.mock("~/lib/collab/media-upload-queue", () => ({ enqueueMedia: (r: unknown) => enqueueMedia(r) }));
vi.mock("~/lib/collab/results-binding", () => ({
    appendPendingPhoto: (...a: unknown[]) => appendPendingPhoto(...a),
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
 *  defect-target assertions live. Pass a doc to exercise the queue path. */
function setup(collabDoc: unknown = null) {
    return renderHook(() =>
        useEditorPhotoUpload({
            state: makeState(),
            findings: { addPhotoToItem: vi.fn(), addPhotoToDefect: vi.fn() } as never,
            uploadFetcher: uploadFetcher as never,
            collabDoc: collabDoc as never,
            activeUnitId: null,
            cameraInputRef: createRef<HTMLInputElement>(),
            libraryInputRef: createRef<HTMLInputElement>(),
            isMobile: false,
            setAddMediaChooser: vi.fn(),
            drain,
        }),
    );
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
        const { result } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(lastTarget().targetType).toBe("defect");
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(lastTarget()).toEqual({ targetType: null, customId: null });
    });

    // Camera frames always belong to the item, so an armed chip must not survive
    // one and catch the single photo that comes after.
    it("clears an armed defect when the camera takes a frame", async () => {
        const { result } = setup();
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        await shootAFrame(result.current.handleCameraFrame);
        expect(lastTarget()).toEqual({ targetType: null, customId: null });

        await pickAPhoto(result.current.handlePhotoUpload);
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
            }),
        );
        await shootAFrame(result.current.handleCameraFrame);
        expect(enqueueMedia).toHaveBeenCalledTimes(1);
    });

    // A defect photo has no pending-doc shape, so it stays on the fetcher.
    it("still posts a defect-targeted photo", async () => {
        const { result } = setup(doc);
        act(() => result.current.openPickerForDefect({ kind: "canned", id: "d1" }));
        await pickAPhoto(result.current.handlePhotoUpload);
        expect(enqueueMedia).not.toHaveBeenCalled();
        expect(lastTarget()).toEqual({ targetType: "defect", customId: "d1" });
    });
});
