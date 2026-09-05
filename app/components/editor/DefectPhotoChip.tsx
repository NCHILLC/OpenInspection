import { Button } from "@core/shared-ui";
import { resolvePhotoDisplayKey } from "~/components/media-studio/photo-display-key";
import { m } from "~/paraglide/messages";

/** Where a photo taken from a defect row is destined for. */
export type DefectPhotoTarget = { kind: "canned" | "custom"; id: string };

const addPhotoIcon = (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
    </svg>
);

type DefectChipPhoto = { key: string; annotatedKey?: string; croppedKey?: string };

/**
 * Builds the per-defect photo thumbnails + "add photo" chip shared by canned
 * and custom rows.
 *
 * A factory rather than a component because the caller renders it inline in
 * two different row types and passes the defect's photos each time; returning
 * null when the parent wires no handler keeps the chip out of the read-only
 * surfaces. Each thumbnail opens the defect-scoped MediaViewer (view +
 * annotate + crop) via `onOpenDefectPhoto` — defect photos have no other
 * entry point into the viewer (they never appear in the item's own strip).
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
        return (
            <span className="mt-1.5 inline-flex items-center gap-1 flex-wrap">
                {photos.map((p, i) => (
                    <button
                        key={p.key}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenDefectPhoto?.(target, i); }}
                        className="w-7 h-7 rounded overflow-hidden border border-ih-border-strong flex-shrink-0"
                    >
                        <img src={photoUrl(resolvePhotoDisplayKey(p))} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </button>
                ))}
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={photoUploading}
                    aria-label={m.editor_item_add_defect_photo_aria()}
                    icon={addPhotoIcon}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAddDefectPhoto(target); }}
                    className="h-auto px-2 py-1 border border-dashed border-ih-border-strong text-ih-fg-3 hover:bg-transparent hover:border-ih-primary hover:text-ih-primary-text"
                >
                    {count > 0
                        ? (count === 1 ? m.editor_item_defect_photo_count_one({ count }) : m.editor_item_defect_photo_count_other({ count }))
                        : m.editor_item_add_photo()}
                </Button>
            </span>
        );
    };
}
