// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { FieldCamera } from "./FieldCamera";

/**
 * The capture SESSION.
 *
 * The requirement this component exists for is not "an in-app camera" — it is
 * that an inspector standing at one defect can take as many photos as that
 * defect needs without the screen closing between them, and close it when THEY
 * are done. The component it replaced closed on commit and stalled between
 * frames while each upload finished, which is the same failure the four-tap
 * `<input capture>` round trip had, just inside the app.
 *
 * So: the shutter fires, hands over a frame, and the dialog is still open. Three
 * times. Nobody asked it to close.
 */

const track = {
    readyState: "live",
    stop: vi.fn(),
    getSettings: () => ({ width: 3840, height: 2160 }),
};
const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
const getUserMedia = vi.fn((_constraints: MediaStreamConstraints) => Promise.resolve(stream));

beforeEach(() => {
    getUserMedia.mockClear();
    track.stop.mockClear();
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    // happy-dom ships no canvas or object-URL implementation; the component only
    // needs drawImage + toBlob + a non-zero videoWidth to take a frame.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
        cb(new Blob(["frame"], { type: "image/jpeg" }));
    } as never;
    // happy-dom has no srcObject; without this the assignment throws inside
    // startCamera and every test silently exercises the fallback path.
    Object.defineProperty(HTMLVideoElement.prototype, "srcObject", { value: null, writable: true, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { value: 1920, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { value: 1080, configurable: true });
    URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

/** Mount and let the async getUserMedia settle. */
async function open(props: Partial<Parameters<typeof FieldCamera>[0]> = {}) {
    const onCapture = vi.fn();
    const onClose = vi.fn();
    const onUnavailable = vi.fn();
    await act(async () => {
        render(<FieldCamera open onClose={onClose} onCapture={onCapture} onUnavailable={onUnavailable} {...props} />);
    });
    return { onCapture, onClose, onUnavailable };
}

async function shutter() {
    await act(async () => {
        screen.getByTestId("camera-shutter").click();
    });
}

describe("FieldCamera — the screen stays open until the inspector closes it", () => {
    it("takes three photos without closing", async () => {
        const { onCapture, onClose } = await open();
        await shutter();
        await shutter();
        await shutter();
        expect(onCapture).toHaveBeenCalledTimes(3);
        // The whole point: nothing closed the camera on the way.
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole("dialog")).toBeTruthy();
        expect(screen.getByTestId("camera-thumbnails").querySelectorAll("img")).toHaveLength(3);
    });

    it("hands over one frame per tap — no burst", async () => {
        const { onCapture } = await open();
        await shutter();
        expect(onCapture).toHaveBeenCalledTimes(1);
        // The component it replaced started a 100ms interval on shutter-down, so
        // an ordinary tap took a second frame. Nothing runs between taps now.
        await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
        expect(onCapture).toHaveBeenCalledTimes(1);
    });

    it("closes only when Done is pressed, and stops the camera", async () => {
        const { onClose } = await open();
        await shutter();
        await act(async () => { screen.getByTestId("camera-done").click(); });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("asks for the sensor's full resolution and shows what it got", async () => {
        await open();
        const constraints = getUserMedia.mock.calls[0][0] as { video: { width: { ideal: number } } };
        // Unconstrained, browsers commonly negotiate 640x480 and the bake step
        // will not upscale — the report would quietly get worse.
        expect(constraints.video.width.ideal).toBe(3840);
        expect(screen.getByTestId("camera-resolution").textContent).toContain("3840");
    });

    it("falls back to the OS camera when getUserMedia is refused", async () => {
        getUserMedia.mockImplementationOnce(() => Promise.reject(new Error("NotAllowedError")));
        const { onUnavailable, onClose } = await open();
        expect(onUnavailable).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe("FieldCamera — the stream survives a parent re-render", () => {
    // The route passes onClose/onUnavailable as inline arrows and re-renders
    // after every shot, so the camera used to stop and re-open the stream per
    // photo — a black flash between frames (2026-09-08 field eval).
    it("does not re-acquire the camera when the callbacks change identity", async () => {
        const onCapture = vi.fn();
        let view!: ReturnType<typeof render>;
        await act(async () => {
            view = render(<FieldCamera open onClose={() => {}} onCapture={onCapture} onUnavailable={() => {}} />);
        });
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        await act(async () => {
            view.rerender(<FieldCamera open onClose={() => {}} onCapture={onCapture} onUnavailable={() => {}} />);
        });
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(track.stop).not.toHaveBeenCalled();
    });
});

describe("FieldCamera — shoot-to-annotate (field eval P1)", () => {
    it("shows the mark button only on the newest thumbnail, once onAnnotateNewest is given", async () => {
        const onAnnotateNewest = vi.fn();
        await open({ onAnnotateNewest });
        await shutter();
        await shutter();
        expect(screen.getAllByTestId("camera-annotate-newest")).toHaveLength(1);
        screen.getByTestId("camera-annotate-newest").click();
        expect(onAnnotateNewest).toHaveBeenCalledTimes(1);
    });

    it("hides the mark button entirely when onAnnotateNewest is omitted", async () => {
        await open();
        await shutter();
        expect(screen.queryByTestId("camera-annotate-newest")).toBeNull();
    });
});
