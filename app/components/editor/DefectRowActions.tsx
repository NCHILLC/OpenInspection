import type { MouseEvent } from "react";
import { Icon } from "@core/shared-ui";
import { defectRowButtonClass } from "./DefectPhotoChip";
import { m } from "~/paraglide/messages";

/** Every control in a defect row sits inside CannedCommentRow's <label>: an
 *  unguarded click would also toggle the row's checkbox. */
const guarded = (fn: () => void) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn(); };

/**
 * One tap from a checked defect to the in-app camera, aimed at that defect.
 * "Add photo" beside it still opens the chooser (camera, library, video); this
 * is the shortcut for the common case, a photo taken on the spot.
 */
export function DefectCameraButton({ name, onCamera }: { name: string; onCamera: () => void }) {
    return (
        <button
            type="button"
            onClick={guarded(onCamera)}
            aria-label={m.editor_defect_camera_aria({ name })}
            className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-ih-border-strong text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary-text"
        >
            <Icon name="camera" size={18} />
        </button>
    );
}

/** Copies a template defect into a separate entry, for the same problem at a second location. */
export function DefectCopyButton({ name, onCopy }: { name: string; onCopy: () => void }) {
    return (
        <button type="button" onClick={guarded(onCopy)} aria-label={m.editor_canned_copy_aria({ name })} className={defectRowButtonClass}>
            <Icon name="copy" size={13} /><span className="text-[12px] font-medium">{m.editor_canned_copy_label()}</span>
        </button>
    );
}
