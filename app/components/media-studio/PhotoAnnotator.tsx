import { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "@core/shared-ui";
import { Stage, Layer, Image as KonvaImage, Circle, Arrow, Line, Label, Tag, Text } from "react-konva";
import type Konva from "konva";
import {
  ANNOTATION_COLOR,
  deserializeAnnotations,
  serializeAnnotations,
  type Annotation,
  type Point,
} from "./annotations";
import { AnnotationToolbar, type ToolId } from "./AnnotationToolbar";
import { m } from "~/paraglide/messages";

interface PhotoAnnotatorProps {
  open: boolean;
  photoUrl: string | null;
  photoIndex?: number;
  totalPhotos?: number;
  sectionName?: string;
  initialAnnotationsJson?: string | null;
  /** whether the open photo is the current report cover. */
  isCover?: boolean;
  /** set the open photo as the report cover (omit to hide the control). */
  onSetCover?: () => void;
  onSave: (data: { blob: Blob; nodesJson: string; caption: string }) => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function PhotoAnnotator({
  open,
  photoUrl,
  photoIndex,
  totalPhotos,
  sectionName,
  initialAnnotationsJson,
  isCover,
  onSetCover,
  onSave,
  onClose,
}: PhotoAnnotatorProps) {
  /* Client-only mount — konva touches the DOM (RR7 SSR safety) */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tool, setTool] = useState<ToolId>("circle");
  const [zoom, setZoom] = useState(1);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [caption, setCaption] = useState(sectionName || "");

  // The loaded source image at natural resolution + the fit scale (natural -> display).
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 600, h: 400 });
  const [fitScale, setFitScale] = useState(1);

  // Drag-to-draw arrow (natural px): press sets the tail, release sets the head.
  const [arrowStart, setArrowStart] = useState<Point | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);

  // Field eval P2 — damage stamps. A stamp is a preset label word armed via
  // AnnotationToolbar; when set, the Label tool's next tap commits it
  // directly instead of opening the free-text input. Stays armed across
  // multiple taps (same convention as circle/arrow staying selected), so
  // marking three cracks is three taps, not three tool re-selections.
  const [stampText, setStampText] = useState<string | null>(null);

  // Freehand drawing (natural px).
  const [freehandPoints, setFreehandPoints] = useState<Point[]>([]);
  const [isDrawingFreehand, setIsDrawingFreehand] = useState(false);

  // Inline HTML label input — positioned in display px over the stage.
  const [labelInput, setLabelInput] = useState<Point | null>(null);
  const [labelText, setLabelText] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);

  const stageRef = useRef<Konva.Stage>(null);

  /* The display scale combines fit-to-viewport and the zoom multiplier. */
  const scale = fitScale * zoom;

  /* Every mark is sized off the photo, not in fixed natural pixels. A 4px
   * stroke and a 40px circle were hairlines on a 4K frame from the in-app
   * camera — tap Circle, see nothing. 1% of the long edge is the unit. */
  const mark = Math.max(natural.w, natural.h) / 100;
  const sw = mark * 0.3;

  /* -------------------------------------------------------------- */
  /* Reset on open + seed annotations                                */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    if (!open) return;
    setAnnotations(deserializeAnnotations(initialAnnotationsJson));
    setCaption(sectionName || "");
    setZoom(1);
    setTool("circle");
    setArrowStart(null);
    setDragPos(null);
    setStampText(null);
    setFreehandPoints([]);
    setIsDrawingFreehand(false);
    setLabelInput(null);
    setLabelText("");
  }, [open, sectionName, initialAnnotationsJson]);

  /* -------------------------------------------------------------- */
  /* Load the source image at natural resolution + compute fit       */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    if (!open || !mounted) return;
    if (!photoUrl) {
      setImage(null);
      setNatural({ w: 600, h: 400 });
      setFitScale(1);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous"; // allow toBlob export of cross-origin photos
    img.onload = () => {
      const w = img.naturalWidth || 600;
      const h = img.naturalHeight || 400;
      const maxW = window.innerWidth * 0.9;
      const maxH = window.innerHeight * 0.7;
      const fit = Math.min(maxW / w, maxH / h, 1);
      setImage(img);
      setNatural({ w, h });
      setFitScale(fit);
    };
    img.src = photoUrl;
  }, [open, mounted, photoUrl]);

  /* -------------------------------------------------------------- */
  /* Focus label input when it appears                               */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    if (labelInput) {
      const t = setTimeout(() => labelInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [labelInput]);

  /* -------------------------------------------------------------- */
  /* Escape to close (label input swallows it first)                 */
  /* -------------------------------------------------------------- */
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (labelInput) {
        setLabelInput(null);
        setLabelText("");
        return;
      }
      e.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose, labelInput]);

  /* -------------------------------------------------------------- */
  /* Pointer -> natural px                                           */
  /* -------------------------------------------------------------- */
  const naturalPointer = useCallback((): Point | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    return { x: p.x / scale, y: p.y / scale };
  }, [scale]);

  /* -------------------------------------------------------------- */
  /* Tap (circle / label)                                            */
  /* -------------------------------------------------------------- */
  const handleStageClick = useCallback(() => {
    if (labelInput) return;
    const pos = naturalPointer();
    if (!pos) return;

    if (tool === "circle") {
      setAnnotations((prev) => [...prev, { kind: "circle", x: pos.x, y: pos.y, r: mark * 4 }]);
    } else if (tool === "text") {
      // A stamp commits straight to an annotation — that IS the one-tap
      // (field eval P2); typing still opens the inline input as before.
      if (stampText) {
        setAnnotations((prev) => [...prev, { kind: "label", x: pos.x, y: pos.y, text: stampText }]);
      } else {
        setLabelInput(pos);
        setLabelText("");
      }
    }
  }, [tool, mark, naturalPointer, labelInput, stampText]);

  /* -------------------------------------------------------------- */
  /* Press / drag / release (freehand + arrow) — mouse AND touch.    */
  /* The old handlers were mouse-only, so on a phone Freehand did     */
  /* nothing at all and Arrow needed two separate taps.              */
  /* -------------------------------------------------------------- */
  const handlePointerDown = useCallback(() => {
    if (labelInput) return;
    const pos = naturalPointer();
    if (!pos) return;
    if (tool === "free") {
      setFreehandPoints([pos]);
      setIsDrawingFreehand(true);
    } else if (tool === "arrow") {
      setArrowStart(pos);
      setDragPos(pos);
    }
  }, [tool, labelInput, naturalPointer]);

  const handlePointerMove = useCallback(() => {
    const pos = naturalPointer();
    if (!pos) return;
    if (isDrawingFreehand) setFreehandPoints((prev) => [...prev, pos]);
    else if (arrowStart) setDragPos(pos);
  }, [isDrawingFreehand, arrowStart, naturalPointer]);

  const handlePointerUp = useCallback(() => {
    if (isDrawingFreehand) {
      if (freehandPoints.length > 1) {
        setAnnotations((prev) => [
          ...prev,
          { kind: "freehand", x: freehandPoints[0].x, y: freehandPoints[0].y, points: freehandPoints },
        ]);
      }
      setFreehandPoints([]);
      setIsDrawingFreehand(false);
    } else if (arrowStart && dragPos) {
      // A press without a drag is a tap, not an arrow.
      if (Math.hypot(dragPos.x - arrowStart.x, dragPos.y - arrowStart.y) > mark) {
        setAnnotations((prev) => [
          ...prev,
          { kind: "arrow", x: arrowStart.x, y: arrowStart.y, x2: dragPos.x, y2: dragPos.y },
        ]);
      }
      setArrowStart(null);
      setDragPos(null);
    }
  }, [isDrawingFreehand, freehandPoints, arrowStart, dragPos, mark]);

  /* -------------------------------------------------------------- */
  /* Label commit                                                    */
  /* -------------------------------------------------------------- */
  const cancelLabel = useCallback(() => {
    setLabelInput(null);
    setLabelText("");
  }, []);

  const commitLabel = useCallback(() => {
    if (labelInput && labelText.trim()) {
      setAnnotations((prev) => [
        ...prev,
        { kind: "label", x: labelInput.x, y: labelInput.y, text: labelText.trim() },
      ]);
    }
    cancelLabel();
  }, [labelInput, labelText, cancelLabel]);

  /* -------------------------------------------------------------- */
  /* Undo / zoom                                                     */
  /* -------------------------------------------------------------- */
  const undoLast = useCallback(() => setAnnotations((prev) => prev.slice(0, -1)), []);
  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.25, 4)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.25, 0.5)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  /* -------------------------------------------------------------- */
  /* Save — export stage to PNG at NATURAL resolution                */
  /* -------------------------------------------------------------- */
  const handleSave = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    // pixelRatio 1/scale maps the scaled-down display stage back to natural px.
    // konva@10 toBlob returns a Promise (callback optional).
    let blob: Blob | null;
    try {
      blob = (await stage.toBlob({ pixelRatio: 1 / scale, mimeType: "image/png" })) as Blob | null;
    } catch {
      // Fallback for environments where toBlob is unavailable on the Stage.
      const canvas = stage.toCanvas({ pixelRatio: 1 / scale });
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
    }
    if (!blob) return;
    onSave({ blob, nodesJson: serializeAnnotations(annotations), caption });
  }, [annotations, caption, scale, onSave]);

  /* -------------------------------------------------------------- */
  /* Render                                                          */
  /* -------------------------------------------------------------- */
  if (!open || !mounted) return null;

  const stageW = natural.w * scale;
  const stageH = natural.h * scale;
  const dragging = tool === "free" || tool === "arrow";

  return (
    /* ds-allow: fixed-dark photo-studio chrome (white/* neutrals + amber-400 hints stay dark in both themes) */
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: "rgba(0,0,0,0.92)" }}>
      {/* -------------------------------------------------------- */}
      {/* Top bar                                                   */}
      {/* -------------------------------------------------------- */}
      <div
        className="flex items-center gap-3 px-4 h-14 flex-shrink-0"
        style={{ background: "rgba(15,23,42,0.8)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* w-11 h-11 is the 44px touch floor (field eval P1). */}
        <button
          onClick={onClose}
          className="w-11 h-11 rounded-md flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors"
          aria-label={m.media_annotate_close_aria()}
        >
          <Icon name="x" className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0 text-center">
          <span className="block truncate text-[14px] font-bold text-white/90">
            {photoIndex != null && totalPhotos != null && totalPhotos > 0
              ? m.media_annotate_photo_of({ index: photoIndex, total: totalPhotos })
              : m.media_annotate_title()}
          </span>
          {tool === "arrow" && !arrowStart && (
            <span className="block text-[11px] text-white/50">{m.media_annotate_arrow_hint()}</span>
          )}
          {tool === "free" && !isDrawingFreehand && (
            <span className="block text-[11px] text-white/50">{m.media_annotate_draw_hint()}</span>
          )}
          {tool === "text" && stampText && (
            <span className="block text-[11px] text-amber-400 font-medium">
              {m.media_annotate_stamp_hint({ label: stampText })}
            </span>
          )}
        </div>

        {/* set the open photo as the report cover.
            Text collapses to icon-only below `sm`: close+cover+undo+save's
            labelled widths cannot fit one 375px row even with a zero-width
            title (field eval P2). Mobile-first, matching AnnotationToolbar's
            own `hidden sm:inline` right below; aria-label keeps the
            accessible name once the visible text is display:none. */}
        {onSetCover && photoUrl && (
          <button
            type="button"
            onClick={onSetCover}
            aria-label={isCover ? m.media_annotate_cover_current() : m.media_annotate_cover_set_title()}
            className={`h-11 w-11 sm:w-auto px-0 sm:px-3 justify-center rounded-md text-[12px] font-bold border transition-colors flex items-center gap-1.5 ${
              isCover
                ? "text-amber-300 bg-amber-400/15 border-amber-400/40"
                : "text-white/60 bg-white/5 border-white/10 hover:bg-white/10"
            }`}
            title={isCover ? m.media_annotate_cover_current() : m.media_annotate_cover_set_title()}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill={isCover ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.5a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            <span className="hidden sm:inline">{isCover ? m.media_annotate_cover_badge() : m.media_annotate_cover_set()}</span>
          </button>
        )}

        <button
          onClick={undoLast}
          disabled={annotations.length === 0}
          aria-label={m.media_annotate_undo_title()}
          className="h-11 w-11 sm:w-auto px-0 sm:px-3 justify-center rounded-md text-[12px] font-bold text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
          title={m.media_annotate_undo_title()}
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
          <span className="hidden sm:inline">{m.common_undo()}</span>
        </button>

        <button
          onClick={handleSave}
          aria-label={m.common_save()}
          className="h-11 w-11 sm:w-auto px-0 sm:px-4 justify-center rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="hidden sm:inline">{m.common_save()}</span>
        </button>
      </div>

      {/* -------------------------------------------------------- */}
      {/* Canvas area                                                */}
      {/* -------------------------------------------------------- */}
      <div className="flex-1 relative overflow-auto">
        <div className="absolute inset-0 flex items-center justify-center">
          {photoUrl && image ? (
            /* touch-action none while a drag tool is armed, or the browser
               scrolls the zoomed canvas instead of drawing on it. */
            <div className="relative" style={{ width: stageW, height: stageH, touchAction: dragging ? "none" : "auto" }}>
              <Stage
                ref={stageRef}
                width={stageW}
                height={stageH}
                onClick={handleStageClick}
                onTap={handleStageClick}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
                style={{ cursor: "crosshair" }}
              >
                {/* Background image layer */}
                <Layer listening={false}>
                  <KonvaImage image={image} width={natural.w} height={natural.h} scaleX={scale} scaleY={scale} />
                </Layer>

                {/* Annotation layer (drawn in natural px, scaled by the stage's group) */}
                <Layer scaleX={scale} scaleY={scale} listening={false}>
                  {annotations.map((ann, i) => {
                    if (ann.kind === "circle") {
                      return (
                        <Circle
                          key={i}
                          x={ann.x}
                          y={ann.y}
                          radius={ann.r}
                          stroke={ANNOTATION_COLOR}
                          strokeWidth={sw}
                        />
                      );
                    }
                    if (ann.kind === "arrow") {
                      return (
                        <Arrow
                          key={i}
                          points={[ann.x, ann.y, ann.x2, ann.y2]}
                          stroke={ANNOTATION_COLOR}
                          fill={ANNOTATION_COLOR}
                          strokeWidth={sw}
                          pointerLength={mark * 1.2}
                          pointerWidth={mark * 1.2}
                        />
                      );
                    }
                    if (ann.kind === "freehand" && ann.points.length > 1) {
                      return (
                        <Line
                          key={i}
                          points={ann.points.flatMap((p) => [p.x, p.y])}
                          stroke={ANNOTATION_COLOR}
                          strokeWidth={sw}
                          lineCap="round"
                          lineJoin="round"
                          tension={0.4}
                        />
                      );
                    }
                    if (ann.kind === "label") {
                      return (
                        <Label key={i} x={ann.x} y={ann.y}>
                          <Tag fill="#000000" opacity={0.85} cornerRadius={mark * 0.3} />
                          <Text
                            text={ann.text}
                            fill={ANNOTATION_COLOR}
                            fontStyle="bold"
                            fontSize={mark * 1.6}
                            padding={mark * 0.4}
                          />
                        </Label>
                      );
                    }
                    return null;
                  })}

                  {/* Arrow being dragged */}
                  {arrowStart && dragPos && (
                    <Arrow
                      points={[arrowStart.x, arrowStart.y, dragPos.x, dragPos.y]}
                      stroke={ANNOTATION_COLOR}
                      fill={ANNOTATION_COLOR}
                      strokeWidth={sw}
                      pointerLength={mark * 1.2}
                      pointerWidth={mark * 1.2}
                      opacity={0.6}
                    />
                  )}

                  {/* Active freehand preview */}
                  {isDrawingFreehand && freehandPoints.length > 1 && (
                    <Line
                      points={freehandPoints.flatMap((p) => [p.x, p.y])}
                      stroke={ANNOTATION_COLOR}
                      strokeWidth={sw}
                      lineCap="round"
                      lineJoin="round"
                      opacity={0.6}
                    />
                  )}
                </Layer>
              </Stage>

              {/* Inline HTML label input — positioned in display px over the stage */}
              {labelInput && (
                <div
                  className="absolute z-10"
                  style={{
                    left: labelInput.x * scale,
                    top: labelInput.y * scale,
                    transform: "translate(-50%, -120%)",
                  }}
                >
                  <div className="bg-slate-800 rounded-lg border border-white/20 p-2 shadow-ih-popover">
                    <input
                      ref={labelInputRef}
                      type="text"
                      value={labelText}
                      onChange={(e) => setLabelText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitLabel();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelLabel();
                        }
                        e.stopPropagation();
                      }}
                      placeholder={m.media_annotate_label_placeholder()}
                      className="w-40 h-7 px-2 rounded bg-slate-700 text-white text-[12px] border border-white/10 outline-none focus:border-ih-primary placeholder-white/30"
                    />
                    <div className="flex justify-end gap-1 mt-1.5">
                      <button
                        onClick={cancelLabel}
                        className="px-2 py-0.5 rounded text-[10px] font-bold text-white/50 hover:text-white/80"
                      >
                        {m.common_cancel()}
                      </button>
                      <button
                        onClick={commitLabel}
                        className="px-2 py-0.5 rounded text-[10px] font-bold text-ih-fg-inverse bg-ih-primary hover:bg-ih-primary-600"
                      >
                        {m.common_add()}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className="w-[600px] h-[400px] rounded-lg flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.15) 100%)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div className="text-center text-white/40">
                <svg className="w-12 h-12 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25a1.5 1.5 0 001.5 1.5z" />
                </svg>
                <p className="text-[13px]">{m.media_annotate_empty_title()}</p>
                <p className="text-[11px] mt-1">{m.media_annotate_empty_subtitle()}</p>
              </div>
            </div>
          )}
        </div>

        {/* Zoom controls (right side) — w-11 h-11 is the 44px touch floor. */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-1">
          <button
            onClick={zoomIn}
            className="w-11 h-11 rounded-md bg-white/10 text-white/70 hover:bg-white/20 flex items-center justify-center text-[16px] font-bold transition-colors"
            title={m.media_annotate_zoom_in()}
          >
            +
          </button>
          <button
            onClick={zoomReset}
            className="w-11 h-11 rounded-md bg-white/10 text-white/60 hover:bg-white/20 flex items-center justify-center text-[10px] font-bold transition-colors"
            title={m.media_annotate_zoom_reset()}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={zoomOut}
            className="w-11 h-11 rounded-md bg-white/10 text-white/70 hover:bg-white/20 flex items-center justify-center text-[16px] font-bold transition-colors"
            title={m.media_annotate_zoom_out()}
          >
            -
          </button>
        </div>

        {/* Annotation count badge */}
        {annotations.length > 0 && (
          <div className="absolute left-4 top-4">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 text-[11px] font-bold text-white/70 border border-white/10">
              <Icon name="edit" className="w-3 h-3" />
              {annotations.length !== 1
                ? m.media_annotate_count_other({ count: annotations.length })
                : m.media_annotate_count_one({ count: annotations.length })}
            </span>
          </div>
        )}
      </div>

      {/* -------------------------------------------------------- */}
      {/* Bottom tool palette                                       */}
      {/* -------------------------------------------------------- */}
      <AnnotationToolbar
        tool={tool}
        caption={caption}
        onSelectTool={(id) => {
          setTool(id);
          setArrowStart(null);
          setDragPos(null);
          setStampText(null);
        }}
        onCaptionChange={setCaption}
        activeStamp={stampText}
        onSelectStamp={(text) => {
          setTool("text");
          setArrowStart(null);
          setDragPos(null);
          setStampText(text);
        }}
      />
    </div>
  );
}
