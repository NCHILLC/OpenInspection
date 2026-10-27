import { useState, useRef, useCallback, useEffect } from "react";
import { Icon, IconButton, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { haptic, HAPTIC_TAP } from "~/lib/haptics";
import { captureQuarterTurns } from "./cameraTurns";

interface Shot {
  id: string;
  url: string;
  /** Where this frame went when it was taken; the toggle can change mid-session. */
  defect: boolean;
}

/** Which shot to mark up: `fromEnd` counts the LATER shots of the same kind, so the caller can index the right photos[] from the end. */
export interface ShotRef {
  defect: boolean;
  fromEnd: number;
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
  /** Name of the defect this session was opened from; absent for a whole-item session. */
  defectName?: string;
  /** The inspector flipped the Item / Defect toggle; the caller re-aims the next frames. */
  onTargetChange?: (target: "item" | "defect") => void;
  /** Field eval P1 — mark a shot up without leaving the camera. */
  onMarkUp?: (shot: ShotRef) => void;
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
export function FieldCamera({ open, onClose, onCapture, onUnavailable, defectName, onTargetChange, onMarkUp }: FieldCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotsRef = useRef<Shot[]>([]);
  // Latest accelerometer reading, for turning a sideways frame upright at the shutter.
  const gravityRef = useRef({ x: 0, y: 0 });
  const [shots, setShots] = useState<Shot[]>([]);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // A session starts aimed at its defect; this records a flip to the whole item.
  const [itemOnly, setItemOnly] = useState(false);
  // Torch is Android Chrome only; the flash button is hidden everywhere else.
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Read through refs, NOT effect dependencies. The route passes both as
  // inline arrows, and every shot re-renders the route (the pending photo
  // lands in the doc), so a `startCamera` that depended on them was rebuilt per
  // frame and the effect below tore the stream down and re-negotiated it —
  // the black flash and the lag between photos.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

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
      const caps: (MediaTrackCapabilities & { torch?: boolean }) | undefined = stream.getVideoTracks()[0]?.getCapabilities?.();
      setTorchSupported(!!caps?.torch);
      setTorchOn(false);
    } catch {
      onUnavailableRef.current();
      onCloseRef.current();
    }
  }, []);

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
      setItemOnly(false);
      setTorchSupported(false);
      setTorchOn(false);
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

  useEffect(() => {
    if (!open) return;
    // A reading from the last time the camera was open says nothing about now:
    // until a fresh sample arrives, trust the screen (captureQuarterTurns' flat case).
    gravityRef.current = { x: 0, y: 0 };
    const onMotion = (e: DeviceMotionEvent): void => {
      const g = e.accelerationIncludingGravity;
      if (g) gravityRef.current = { x: g.x ?? 0, y: g.y ?? 0 };
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [open]);

  // Revoke every thumbnail URL on unmount — `open` going false is the common
  // path, but the route can drop the overlay outright.
  useEffect(() => () => clearShots(), [clearShots]);

  if (!open) return null;

  const defectTarget = !!defectName && !itemOnly;

  function pickTarget(target: "item" | "defect") {
    setItemOnly(target === "item");
    onTargetChange?.(target);
  }

  function toggleTorch() {
    const next = !torchOn;
    const advanced: Array<MediaTrackConstraintSet & { torch?: boolean }> = [{ torch: next }];
    void streamRef.current?.getVideoTracks()[0]?.applyConstraints({ advanced }).then(() => setTorchOn(next), () => {});
  }

  /** The ref handed to `onMarkUp` for the shot at `index`. */
  function shotRef(index: number): ShotRef {
    const defect = shots[index].defect;
    return { defect, fromEnd: shots.slice(index + 1).filter((x) => x.defect === defect).length };
  }

  function shoot() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    // iOS only delivers motion after a permission prompt, which needs this tap;
    // the first frame goes unturned there, the rest are corrected.
    void (globalThis.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> } | undefined)?.requestPermission?.().catch(() => {});
    const w = video.videoWidth;
    const h = video.videoHeight;
    const defect = defectTarget;
    const turns = captureQuarterTurns(gravityRef.current.x, gravityRef.current.y, screen.orientation?.angle ?? 0);
    canvas.width = turns % 2 ? h : w;
    canvas.height = turns % 2 ? w : h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-turns * Math.PI) / 2);
    ctx.drawImage(video, -w / 2, -h / 2);
    // toBlob, not toDataURL: the frame goes straight to the upload queue as
    // binary, and the thumbnail is an object URL rather than base64 in state.
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        // The shutter has no sound and the preview does not freeze, so without
        // this there is nothing to tell a gloved hand the frame was taken.
        haptic(HAPTIC_TAP);
        onCapture(blob);
        const shot = { id: crypto.randomUUID(), url: URL.createObjectURL(blob), defect };
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
        <div className="flex items-center gap-2">
          {torchSupported && (
            /* ds-allow: over-video control — stays light-on-dark regardless of theme (legible over arbitrary camera footage) */
            <IconButton
              type="button"
              onClick={toggleTorch}
              aria-label={m.editor_camera_flash_aria()}
              aria-pressed={torchOn}
              data-testid="camera-flash"
              className={`w-12 h-12 rounded-full ${torchOn ? "bg-ih-primary text-ih-primary-fg" : "bg-black/40 text-white hover:bg-black/60"}`}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 2L3 14h9l-1 8 10-12h-9z" /></svg>
            </IconButton>
          )}
          {/* ds-allow: over-video control — stays light-on-dark regardless of theme (legible over arbitrary camera footage) */}
          <IconButton type="button" onClick={switchFacing} aria-label={m.editor_camera_switch_aria()} className="w-12 h-12 rounded-full bg-black/40 text-white hover:bg-black/60">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-3M20 15a8 8 0 01-14 3" /></svg>
          </IconButton>
        </div>
      </div>

      {/* Where the next frame goes. The defect segment exists only when the
          session was opened from a defect; it is red so a defect photo is never
          mistaken for an item photo. */}
      <div
        role="radiogroup"
        aria-label={m.editor_camera_target_aria()}
        className={`relative z-10 mt-3 mx-3 grid gap-1.5 ${defectName ? "grid-cols-[110px_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {/* ds-allow: over-video segments — light-on-dark in both themes; the defect segment is the red alert token */}
        <button
          type="button"
          role="radio"
          aria-checked={!defectTarget}
          onClick={() => pickTarget("item")}
          data-testid="camera-target-item"
          className={`h-14 rounded-md px-2.5 flex flex-col items-start justify-center min-w-0 ${!defectTarget ? "bg-ih-primary text-ih-primary-fg" : "border border-white/40 bg-black/40 text-white"}`}
        >
          <span className="text-[13px] font-bold tracking-wider uppercase">{m.editor_camera_target_item()}</span>
          <span className="text-[15px] font-bold truncate max-w-full">{m.editor_camera_target_item_name()}</span>
        </button>
        {defectName && (
          /* ds-allow: over-video segment — light-on-dark in both themes; red alert token */
          <button
            type="button"
            role="radio"
            aria-checked={defectTarget}
            onClick={() => pickTarget("defect")}
            data-testid="camera-target-defect"
            className={`h-14 rounded-md px-2.5 flex flex-col items-start justify-center min-w-0 ${defectTarget ? "bg-ih-bad text-white" : "border border-white/40 bg-black/40 text-white"}`}
          >
            <span className="text-[13px] font-bold tracking-wider uppercase">{m.editor_camera_target_defect()}</span>
            <span className="text-[15px] font-bold truncate max-w-full">{defectName}</span>
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* ds-allow: over-video count pill — light-on-dark in both themes */}
      <div
        data-testid="camera-count"
        aria-live="polite"
        className="relative z-10 mb-3 ml-3 self-start h-8 px-3 rounded-full bg-black/80 text-white text-[15px] font-bold flex items-center tabular-nums"
      >
        {shots.length === 1 ? m.editor_camera_session_one() : m.editor_camera_session_other({ count: shots.length })}
      </div>

      {/* This session's shots, newest first: the confirmation that a tap landed, which
          in gloves and glare is the point. Tap one for markup; a red dot is a defect shot. */}
      <div className="relative z-10 mb-3 px-4 h-[72px] flex items-center">
        {shots.length === 0 ? (
          /* ds-allow: over-video hint — light-on-dark in both themes */
          <span className="text-[15px] text-white/80">{m.editor_camera_hint()}</span>
        ) : (
          <div className="flex gap-2 overflow-x-auto" data-testid="camera-thumbnails">
            {shots.map((s, i) => (
              <button
                key={s.id}
                type="button"
                disabled={!onMarkUp}
                onClick={() => onMarkUp?.(shotRef(i))}
                aria-label={s.defect ? m.editor_camera_shot_defect_aria({ n: i + 1 }) : m.editor_camera_shot_item_aria({ n: i + 1 })}
                data-testid="camera-shot"
                className="relative shrink-0"
              >
                {/* ds-allow: fixed-dark camera overlay thumbnails (light-on-dark border) */}
                <img src={s.url} alt="" className="w-16 h-16 object-cover rounded-md border-2 border-white/30" />
                {s.defect && (
                  /* ds-allow: dot over the fixed-dark camera overlay — the dark border keeps it legible on any thumbnail */
                  <span data-testid="camera-shot-defect" aria-hidden="true" className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-ih-bad border-2 border-black" />
                )}
              </button>
            )).reverse()}
          </div>
        )}
      </div>

      {/* Bottom action row */}
      <div className="relative z-10 pb-8 px-4 flex items-center justify-between gap-4">
        {/* ds-allow: over-video control — light-on-dark in both themes */}
        <button
          type="button"
          disabled={shots.length === 0 || !onMarkUp}
          onClick={() => onMarkUp?.(shotRef(shots.length - 1))}
          aria-label={m.editor_camera_annotate_aria()}
          data-testid="camera-markup"
          className="w-24 h-14 rounded-md border border-white/40 bg-black/40 text-white flex flex-col items-center justify-center gap-0.5 disabled:opacity-40"
        >
          <Icon name="edit" className="w-5 h-5" />
          <span className="text-[14px] font-semibold">{m.editor_camera_markup()}</span>
        </button>

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

        {/* size="lg" is the 44px touch floor (field eval P1 — this measured 36px). */}
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={onClose}
          className="w-24 rounded-full shadow-ih-popover"
          data-testid="camera-done"
        >
          {m.common_done()}
        </Button>
      </div>
    </div>
  );
}
