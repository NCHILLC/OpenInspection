import { useState, useRef, useCallback, useEffect } from "react";
import { Icon, IconButton, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { haptic, HAPTIC_TAP } from "~/lib/haptics";

interface Shot {
  id: string;
  url: string;
}

export interface FieldCameraProps {
  open: boolean;
  onClose: () => void;
  /** One frame, handed over the moment the shutter fires. */
  onCapture: (blob: Blob) => void;
  /**
   * The camera could not be opened (permission denied, no device, camera held
   * by another app). The caller falls back to the OS camera input — an
   * inspector standing in front of a defect always gets a camera.
   */
  onUnavailable: () => void;
}

/** Below this the frame cannot carry a shingle nail head; say so rather than
 *  quietly shooting evidence nobody can read at review time. */
const MIN_USABLE_LONG_EDGE = 1280;

/**
 * The in-app capture screen.
 *
 * ── One tap is one photo, and the screen stays open ────────────────────────
 * This replaced a hold-to-burst camera. The burst was never reachable as
 * designed — `onShutterDown` started its 100 ms interval immediately instead of
 * after the 200 ms hold its own comment described, so an ordinary tap that
 * lasted longer than 100 ms silently took a second frame. It also held up to 30
 * `toDataURL` strings in React state: base64 in the JS heap on the device least
 * able to spare it, re-parsed through `fetch()` on commit.
 *
 * Both are gone. The shutter takes exactly one frame and hands it straight to
 * `onCapture`, which queues it — so the upload runs while the camera is still
 * open and the next shot never waits on the last one. Closing is the
 * inspector's decision, not something the app does after every photo.
 *
 * ponytail: no in-camera discard. A frame is already queued by the time its
 * thumbnail appears, so discarding it here would mean reaching back into the
 * queue and the doc. Deleting from the item's photo strip (which has undo)
 * covers a bad frame; revisit if that turns out to be a common move.
 */
export function FieldCamera({ open, onClose, onCapture, onUnavailable }: FieldCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotsRef = useRef<Shot[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const startCamera = useCallback(async (facingMode: string) => {
    try {
      // Ask for the sensor's full resolution. Without these constraints browsers
      // commonly negotiate 640x480, which the bake step will not upscale — the
      // report would have quietly got worse the day the in-app camera shipped.
      // `ideal` (not `exact`) so a device that cannot do 4K still opens.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      const s = stream.getVideoTracks()[0]?.getSettings();
      setDims(s?.width && s?.height ? { w: s.width, h: s.height } : null);
    } catch {
      onUnavailable();
      onClose();
    }
  }, [onClose, onUnavailable]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearShots = useCallback(() => {
    for (const s of shotsRef.current) URL.revokeObjectURL(s.url);
    shotsRef.current = [];
    setShots([]);
  }, []);

  useEffect(() => {
    if (open) {
      void startCamera(facing);
    } else {
      stopCamera();
      clearShots();
      setDims(null);
    }
    return () => stopCamera();
  }, [open, facing, startCamera, stopCamera, clearShots]);

  // iOS suspends a live track when the tab backgrounds (a phone call mid-
  // inspection), and returns a black frame on the way back. Re-acquire instead.
  useEffect(() => {
    if (!open) return;
    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      if (streamRef.current?.getVideoTracks()[0]?.readyState === "live") return;
      stopCamera();
      void startCamera(facing);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [open, facing, startCamera, stopCamera]);

  // Revoke every thumbnail URL on unmount — `open` going false is the common
  // path, but the route can drop the overlay outright.
  useEffect(() => () => clearShots(), [clearShots]);

  if (!open) return null;

  function shoot() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    // toBlob, not toDataURL: the frame goes straight to the upload queue as
    // binary, and the thumbnail is an object URL rather than base64 in state.
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        // The shutter has no sound and the preview does not freeze, so without
        // this there is nothing to tell a gloved hand the frame was taken.
        haptic(HAPTIC_TAP);
        onCapture(blob);
        const shot = { id: crypto.randomUUID(), url: URL.createObjectURL(blob) };
        shotsRef.current = [...shotsRef.current, shot];
        setShots(shotsRef.current);
      },
      "image/jpeg",
      0.92,
    );
  }

  function switchFacing() {
    stopCamera();
    setFacing((f) => (f === "user" ? "environment" : "user"));
  }

  const lowRes = dims != null && Math.max(dims.w, dims.h) < MIN_USABLE_LONG_EDGE;

  return (
    /* ds-allow: fixed-dark full-screen camera overlay (stays dark in both themes) */
    <div className="fixed inset-0 z-50 bg-black flex flex-col" role="dialog" aria-label={m.editor_camera_aria()} aria-modal="true">
      <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />

      {/* Top chrome */}
      {/* ds-allow: fixed-dark camera overlay chrome (light-on-dark) */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-4 gap-2">
        {/* ds-allow: over-video control — stays light-on-dark regardless of theme (legible over arbitrary camera footage) */}
        <IconButton type="button" onClick={onClose} aria-label={m.editor_camera_close_aria()} className="w-12 h-12 rounded-full bg-black/40 text-white hover:bg-black/60">
          <Icon name="x" className="w-6 h-6" />
        </IconButton>
        {/* The negotiated frame size, on screen, because an in-app camera that
            silently drops to 640x480 produces a report nobody can review. */}
        {dims && (
          /* ds-allow: over-video readout — light-on-dark in both themes */
          <div
            data-testid="camera-resolution"
            className={`text-[13px] font-mono px-3 py-1.5 rounded-full ${lowRes ? "bg-ih-bad text-white font-bold" : "bg-black/40 text-white"}`}
          >
            {m.editor_camera_resolution({ width: dims.w, height: dims.h })}
          </div>
        )}
        {/* ds-allow: over-video control — stays light-on-dark regardless of theme (legible over arbitrary camera footage) */}
        <IconButton type="button" onClick={switchFacing} aria-label={m.editor_camera_switch_aria()} className="w-12 h-12 rounded-full bg-black/40 text-white hover:bg-black/60">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-3M20 15a8 8 0 01-14 3" /></svg>
        </IconButton>
      </div>

      <div className="flex-1" />

      {/* What has been shot this session — the confirmation that a tap landed,
          which in gloves and glare is the whole point of showing them. */}
      {shots.length > 0 && (
        <div className="relative z-10 mb-3 px-4">
          {/* ds-allow: fixed-dark camera overlay thumbnails (light-on-dark border) */}
          <div className="flex gap-2 overflow-x-auto pb-1" data-testid="camera-thumbnails">
            {shots.map((s) => (
              <img
                key={s.id}
                src={s.url}
                className="w-16 h-16 shrink-0 object-cover rounded-md border-2 border-white/30"
                alt={m.editor_camera_frame_alt()}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bottom action row */}
      <div className="relative z-10 pb-8 px-4 flex items-center justify-between gap-4">
        {shots.length > 0 ? (
          /* ds-allow: over-video count — light-on-dark in both themes */
          <div data-testid="camera-count" className="w-24 text-white text-[15px] font-bold tabular-nums">
            {m.editor_camera_captured_count({ count: shots.length })}
          </div>
        ) : <div className="w-24" />}

        {/* ds-allow: fixed-dark camera shutter (white button + dark label, stays fixed in both themes) */}
        <button
          type="button"
          onClick={shoot}
          className="w-20 h-20 rounded-full bg-white border-4 border-white/40 transition hover:scale-105 active:scale-95 flex items-center justify-center"
          aria-label={m.editor_camera_shutter_aria()}
          data-testid="camera-shutter"
        >
          {/* ds-allow: dark label on the white shutter button (fixed-dark camera overlay) */}
          <span className="text-slate-700 text-[13px] font-bold tracking-widest uppercase">{m.editor_camera_shoot()}</span>
        </button>

        <Button
          type="button"
          variant="primary"
          onClick={onClose}
          className="w-24 rounded-full px-5 py-3 shadow-ih-popover"
          data-testid="camera-done"
        >
          {m.common_done()}
        </Button>
      </div>
    </div>
  );
}
