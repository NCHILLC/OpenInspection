import { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "@core/shared-ui";
import { Stage, Layer, Image as KonvaImage, Circle, Rect, Arrow, Line, Label, Tag, Text } from "react-konva";
import type Konva from "konva";
import {
  ANNOTATION_COLOR,
  deserializeAnnotations,
  serializeAnnotations,
  type Annotation,
  type Point,
} from "./annotations";
import { AnnotationToolbar, type ToolId } from "./AnnotationToolbar";
import { AnnotatorTopBar } from "./AnnotatorTopBar";
import { AnnotatorPlaceholder } from "./AnnotatorPlaceholder";
import { usePhotoSource } from "./usePhotoSource";
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
  /** Canvas S08 header (phone): which kind of photo this is, and the name of the item or defect it belongs to. */
  target?: "item" | "defect";
  subject?: string;
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
  target,
  subject,
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
  const [color, setColor] = useState<string>(ANNOTATION_COLOR);

  // The source photo at natural resolution + the fit scale (natural -> display),
  // and — N6 — whether the request for it came back a failure.
  const { image, natural, fitScale, failed: loadFailed, retry: retryLoad } = usePhotoSource(
    photoUrl,
    open && mounted,
  );

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
    setColor(ANNOTATION_COLOR);
    setArrowStart(null);
    setDragPos(null);
    setStampText(null);
    setFreehandPoints([]);
    setIsDrawingFreehand(false);
    setLabelInput(null);
    setLabelText("");
  }, [open, sectionName, initialAnnotationsJson]);

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
      setAnnotations((prev) => [...prev, { kind: "circle", x: pos.x, y: pos.y, r: mark * 4, color }]);
    } else if (tool === "box") {
      const w = mark * 10, h = mark * 7;
      setAnnotations((prev) => [...prev, { kind: "rect", x: pos.x - w / 2, y: pos.y - h / 2, w, h, color }]);
    } else if (tool === "text") {
      // A stamp commits straight to an annotation — that IS the one-tap
      // (field eval P2); typing still opens the inline input as before.
      if (stampText) {
        setAnnotations((prev) => [...prev, { kind: "label", x: pos.x, y: pos.y, text: stampText, color }]);
      } else {
        setLabelInput(pos);
        setLabelText("");
      }
    }
  }, [tool, mark, naturalPointer, labelInput, stampText, color]);

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
          { kind: "freehand", x: freehandPoints[0].x, y: freehandPoints[0].y, points: freehandPoints, color },
        ]);
      }
      setFreehandPoints([]);
      setIsDrawingFreehand(false);
    } else if (arrowStart && dragPos) {
      // A press without a drag is a tap, not an arrow.
      if (Math.hypot(dragPos.x - arrowStart.x, dragPos.y - arrowStart.y) > mark) {
        setAnnotations((prev) => [
          ...prev,
          { kind: "arrow", x: arrowStart.x, y: arrowStart.y, x2: dragPos.x, y2: dragPos.y, color },
        ]);
      }
      setArrowStart(null);
      setDragPos(null);
    }
  }, [isDrawingFreehand, freehandPoints, arrowStart, dragPos, mark, color]);

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
        { kind: "label", x: labelInput.x, y: labelInput.y, text: labelText.trim(), color },
      ]);
    }
    cancelLabel();
  }, [labelInput, labelText, cancelLabel, color]);

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
  // Canvas S08: "Photo 2 · Defect" (photoIndex is 0-based); other callers keep the plain title.
  const eyebrow = target && photoIndex != null
    ? (target === "defect" ? m.editor_markup_photo_defect : m.editor_markup_photo_item)({ n: photoIndex + 1 })
    : m.media_annotate_title();

  return (
    /* ds-allow: fixed-dark photo-studio chrome (white/* neutrals + amber-400 hints stay dark in both themes) */
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: "rgba(0,0,0,0.92)" }}>
      <AnnotatorTopBar
        onClose={onClose}
        title={
          photoIndex != null && totalPhotos != null && totalPhotos > 0
            ? m.media_annotate_photo_of({ index: photoIndex, total: totalPhotos })
            : m.media_annotate_title()
        }
        hint={(tool === "arrow" && !arrowStart && m.media_annotate_arrow_hint()) || (tool === "free" && !isDrawingFreehand && m.media_annotate_draw_hint()) || null}
        stampLabel={tool === "text" ? stampText : null}
        phoneEyebrow={eyebrow}
        phoneSubject={subject}
        cover={onSetCover && photoUrl ? { isCover: !!isCover, onSet: onSetCover } : undefined}
        canUndo={annotations.length > 0}
        onUndo={undoLast}
        onSave={handleSave}
      />

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
                    const c = ann.color ?? ANNOTATION_COLOR;
                    if (ann.kind === "circle") {
                      return (
                        <Circle
                          key={i}
                          x={ann.x}
                          y={ann.y}
                          radius={ann.r}
                          stroke={c}
                          strokeWidth={sw}
                        />
                      );
                    }
                    if (ann.kind === "rect") {
                      return <Rect key={i} x={ann.x} y={ann.y} width={ann.w} height={ann.h} stroke={c} strokeWidth={sw} cornerRadius={mark * 0.3} />;
                    }
                    if (ann.kind === "arrow") {
                      return (
                        <Arrow
                          key={i}
                          points={[ann.x, ann.y, ann.x2, ann.y2]}
                          stroke={c}
                          fill={c}
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
                          stroke={c}
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
                            fill={c}
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
                      stroke={color}
                      fill={color}
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
                      stroke={color}
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
            <AnnotatorPlaceholder photoUrl={photoUrl} failed={loadFailed} onRetry={retryLoad} />
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
        color={color}
        onSelectColor={setColor}
        canUndo={annotations.length > 0}
        onUndo={undoLast}
      />
    </div>
  );
}
