import { Icon } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

interface AnnotatorTopBarProps {
  onClose: () => void;
  /** Desktop title, e.g. "Photo 2 of 5". */
  title: string;
  /** Desktop sub-line under the title (arrow / draw hints); the phone shows hints under the tools. */
  hint: string | null;
  stampLabel: string | null;
  /** Canvas S08 header: "Photo 2 · Defect" over the defect's (or item's) name. Phone only. */
  phoneEyebrow: string;
  phoneSubject?: string;
  /** Present when the open photo can be made the report cover. */
  cover?: { isCover: boolean; onSet: () => void };
  canUndo: boolean;
  onUndo: () => void;
  onSave: () => void;
}

export function AnnotatorTopBar({ onClose, title, hint, stampLabel, phoneEyebrow, phoneSubject, cover, canUndo, onUndo, onSave }: AnnotatorTopBarProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 h-14 flex-shrink-0 max-md:h-16 max-md:gap-2 max-md:pl-1 max-md:pr-3"
      style={{ background: "rgba(15,23,42,0.8)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* ds-allow: fixed-dark photo-studio chrome. w-11 h-11 is the 44px touch floor (field eval P1); the phone header is 48. */}
      <button
        onClick={onClose}
        className="w-11 h-11 max-md:w-12 max-md:h-12 rounded-md flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors"
        aria-label={m.media_annotate_close_aria()}
      >
        <Icon name="x" className="w-5 h-5" />
      </button>

      <div className="flex-1 min-w-0 text-center max-md:text-left">
        {/* ds-allow: fixed-dark photo-studio chrome (white/* neutrals + amber-400 hints stay dark in both themes) */}
        <div className="max-md:hidden">
          <span className="block truncate text-[14px] font-bold text-white/90">{title}</span>
          {hint && <span className="block text-[11px] text-white/50">{hint}</span>}
          {stampLabel && (
            <span className="block text-[11px] text-amber-400 font-medium">{m.media_annotate_stamp_hint({ label: stampLabel })}</span>
          )}
        </div>
        <div className="md:hidden">
          <span className="block truncate text-[14px] font-semibold uppercase tracking-[0.08em] text-white/75">{phoneEyebrow}</span>
          {phoneSubject && <span className="block truncate text-[20px] leading-tight font-bold text-white">{phoneSubject}</span>}
        </div>
      </div>

      {/* Set the open photo as the report cover. Text collapses to icon-only below `sm`:
          close+cover+undo+save's labelled widths cannot fit one 375px row (field eval P2).
          The phone drops the cover and undo controls: undo moves under the tools, and
          the cover is set from the photo review. */}
      {cover && (
        /* ds-allow: fixed-dark photo-studio chrome (white/* neutrals + amber-300 cover state stay dark in both themes) */
        <button
          type="button"
          onClick={cover.onSet}
          aria-label={cover.isCover ? m.media_annotate_cover_current() : m.media_annotate_cover_set_title()}
          className={`max-md:hidden h-11 w-11 sm:w-auto px-0 sm:px-3 justify-center rounded-md text-[12px] font-bold border transition-colors flex items-center gap-1.5 ${
            cover.isCover
              ? "text-amber-300 bg-amber-400/15 border-amber-400/40"
              : "text-white/60 bg-white/5 border-white/10 hover:bg-white/10"
          }`}
          title={cover.isCover ? m.media_annotate_cover_current() : m.media_annotate_cover_set_title()}
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill={cover.isCover ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.5a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
          <span className="hidden sm:inline">{cover.isCover ? m.media_annotate_cover_badge() : m.media_annotate_cover_set()}</span>
        </button>
      )}

      {/* ds-allow: fixed-dark photo-studio chrome (white/* neutrals stay dark in both themes) */}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        aria-label={m.media_annotate_undo_title()}
        className="max-md:hidden h-11 w-11 sm:w-auto px-0 sm:px-3 justify-center rounded-md text-[12px] font-bold text-white/60 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
        title={m.media_annotate_undo_title()}
      >
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
        </svg>
        <span className="hidden sm:inline">{m.common_undo()}</span>
      </button>

      <button
        onClick={onSave}
        aria-label={m.common_save()}
        className="h-11 w-11 sm:w-auto px-0 sm:px-4 justify-center rounded-md bg-ih-primary text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-primary-600 transition-colors flex items-center gap-1.5 max-md:h-12 max-md:w-auto max-md:px-4.5 max-md:text-[17px] max-md:font-extrabold max-md:text-ih-primary-fg"
      >
        <svg className="w-3.5 h-3.5 shrink-0 max-md:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="hidden sm:inline max-md:inline">{m.common_save()}</span>
      </button>
    </div>
  );
}
