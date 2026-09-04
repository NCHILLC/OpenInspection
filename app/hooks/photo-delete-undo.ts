import type * as Y from "yjs";
import { pushToast } from "./useToast";
import {
    appendPhoto as bindingAppendPhoto,
    removePhoto as bindingRemovePhoto,
    reorderPhotos as bindingReorderPhotos,
} from "~/lib/collab/results-binding";
import { m } from "~/paraglide/messages";

/** The stored shape of one photo entry. Structural on purpose — this module
 *  moves entries around, it never reads their fields. */
type PhotoEntry = { key: string } & Record<string, unknown>;

export interface DeletePhotoWithUndoDeps {
    /** Null when collab is not live; the local projection is then the only store. */
    collabDoc: Y.Doc | null;
    /** Composite finding key for this item, or null when the section is unresolvable. */
    findingKey: string | null;
    sectionId: string | undefined;
    itemId: string;
    activeUnitId: string | null;
    /** Position of the photo being deleted, within the item's photo array. */
    index: number;
    /** The item's photos BEFORE the delete. */
    photos: PhotoEntry[];
    patchItemPhotos: (itemId: string, next: (photos: PhotoEntry[]) => PhotoEntry[]) => void;
}

/**
 * Delete one item photo and offer a way back.
 *
 * The viewer's toolbar is seven text buttons in one row; on a 375px screen with
 * a gloved thumb, Caption and Delete are the same target. Delete used to splice
 * the array and remove the doc entry with no dialog, no toast and no undo — the
 * only unrecoverable action in the editor, on the smallest target in it.
 *
 * Undo is a toast action rather than a confirmation dialog: a dialog taxes every
 * deliberate delete to catch the rare accident, and `pushToast` already renders
 * an action button, so this costs one toast and no new component.
 *
 * Restoring means putting the entry back where it was, not on the end — photo
 * order is report order. The doc has no insert-at-index, so the entry is
 * appended and the array reordered to the key order it had before the delete.
 *
 * ponytail: restores the doc entry, not the R2 object. Delete does not remove
 * the binary today; revisit if it ever does.
 */
export function deletePhotoWithUndo(d: DeletePhotoWithUndoDeps): void {
    const { collabDoc, findingKey, sectionId, itemId, activeUnitId, index, photos, patchItemPhotos } = d;
    const entry = photos[index];
    if (!entry) return;
    const keysBefore = photos.map((p) => p.key);
    const docKey = entry.key;

    patchItemPhotos(itemId, (list) => list.filter((_, i) => i !== index));
    if (collabDoc && findingKey && docKey) bindingRemovePhoto(collabDoc, findingKey, docKey);

    // Only offer undo when it can actually put things back. Without a section
    // there is no key to append under, and a half-restore (local but not doc)
    // would resolve back to deleted on the next doc sync — worse than no undo.
    const canRestoreDoc = !collabDoc || Boolean(findingKey && sectionId);
    if (!canRestoreDoc) return;

    pushToast({
        message: m.media_photo_deleted(),
        variant: "neutral",
        durationMs: 6000,
        actionLabel: m.common_undo(),
        onAction: () => {
            patchItemPhotos(itemId, (list) => [...list.slice(0, index), entry, ...list.slice(index)]);
            if (collabDoc && findingKey && sectionId) {
                bindingAppendPhoto(collabDoc, sectionId, itemId, entry, activeUnitId);
                bindingReorderPhotos(collabDoc, findingKey, keysBefore);
            }
        },
    });
}
