import { Icon } from "@core/shared-ui";
import { resolvePhotoDisplayKey } from "~/components/media-studio/photo-display-key";
import { m } from "~/paraglide/messages";

/** Where a photo taken from a defect row is destined for. */
export type DefectPhotoTarget = { kind: "canned" | "custom"; id: string };

const photoIcon = (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
    </svg>
);

/** Matches the bordered Edit/Flag buttons this chip sits beside (CannedCommentTabs). */
export const defectRowButtonClass =
    "inline-flex items-center gap-1 px-2 py-1 rounded-md border border-ih-border-strong text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary-text";

type DefectChipPhoto = { key: string; annotatedKey?: string; croppedKey?: string };

/**
 * Builds the per-defect "Photos" control shared by canned and custom rows —
 * a bordered button matching the Edit/Flag buttons beside it (same
 * `defectRowButtonClass`).
 *
 * Empty state is a plain "Add photo" button. Once photos exist, the label
 * button opens the defect-scoped MediaViewer at photo 0 (view + annotate +
 * crop — defect photos have no other entry point into the viewer, they never
 * appear in the item's own strip); thumbnails open the viewer at their own
 * index; a trailing dashed "+" tile (mirrors ItemPhotoStrip's own add-tile)
 * attaches another photo without leaving the row.
 *
 * A factory rather than a component because the caller renders it inline in
 * two different row types and passes the defect's photos each time; returning
 * null when the parent wires no handler keeps the chip out of the read-only
 * surfaces.
 */
export function makeDefectPhotoChip(
    onAddDefectPhoto: ((target: DefectPhotoTarget) => void) | undefined,
    photoUploading: boolean | undefined,
    photoUrl: (key: string) => string,
    onOpenDefectPhoto?: (target: DefectPhotoTarget, index: number) => void,
) {
    return (target: DefectPhotoTarget, photos: DefectChipPhoto[]) => {
        if (!onAddDefectPhoto) return null;
        const count = photos.length;
        const add = (e: { preventDefault(): void; stopPropagation(): void }) => {
            e.preventDefault(); e.stopPropagation(); onAddDefectPhoto(target);
        };
        if (count === 0) {
            return (
                // The item header carries its own "Add photo" button, so without a
                // label both compute the SAME accessible name and nothing tells a
                // screen-reader user which one files under the defect. The
                // `count > 0` branch below already labels its `+` this way.
                // "Add photo" stays the visible text and is contained in the
                // label, so Label-in-Name (WCAG 2.5.3) still holds.
                <button
                    type="button"
                    disabled={photoUploading}
                    aria-label={m.editor_item_add_defect_photo_aria()}
                    onClick={add}
                    className={defectRowButtonClass}
                >
                    {photoIcon}
                    <span className="text-[12px] font-medium">{m.editor_item_add_photo()}</span>
                </button>
            );
        }
        return (
            <span className={defectRowButtonClass}>
                <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenDefectPhoto?.(target, 0); }}
                    className="inline-flex items-center gap-1"
                >
                    {photoIcon}
                    <span className="text-[12px] font-medium">
                        {count === 1 ? m.editor_item_defect_photo_count_one({ count }) : m.editor_item_defect_photo_count_other({ count })}
                    </span>
                </button>
                <span className="inline-flex items-center gap-1 ml-1">
                    {photos.map((p, i) => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenDefectPhoto?.(target, i); }}
                            className="w-6 h-6 rounded overflow-hidden border border-ih-border-strong flex-shrink-0"
                        >
                            <img src={photoUrl(resolvePhotoDisplayKey(p))} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </button>
                    ))}
                    <button
                        type="button"
                        disabled={photoUploading}
                        aria-label={m.editor_item_add_defect_photo_aria()}
                        onClick={add}
                        className="w-6 h-6 rounded border border-dashed border-ih-border flex items-center justify-center text-ih-fg-4 hover:border-ih-primary hover:text-ih-primary-text flex-shrink-0"
                    >
                        <Icon name="plus" size={12} />
                    </button>
                </span>
                <Icon name="chevR" size={14} className="text-ih-fg-4 ml-0.5 flex-shrink-0" />
            </span>
        );
    };
}
