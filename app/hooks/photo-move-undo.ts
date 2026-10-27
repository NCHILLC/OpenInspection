import type * as Y from "yjs";
import {
    movePhoto,
    reorderPhotos as bindingReorderPhotos,
} from "~/lib/collab/results-binding";

type PhotoEntry = { key: string } & Record<string, unknown>;

export interface RestoreMovedPhotosDeps {
    collabDoc: Y.Doc | null;
    fromItemId: string;
    fromFindingKey: string | null;
    toItemId: string;
    toFindingKey: string | null;
    keysBefore: string[];
    moved: Array<{ index: number; entry: PhotoEntry }>;
    patchItemPhotos: (itemId: string, next: (photos: PhotoEntry[]) => PhotoEntry[]) => void;
}

export interface MovePhotosWithUndoDeps {
    collabDoc: Y.Doc | null;
    fromItemId: string;
    fromFindingKey: string | null;
    toItemId: string;
    toFindingKey: string | null;
    snapshot: PhotoEntry[];
    indices: number[];
    patchItemPhotos: (itemId: string, next: (photos: PhotoEntry[]) => PhotoEntry[]) => void;
}

export function restoreMovedPhotos(d: RestoreMovedPhotosDeps): void {
    const {
        collabDoc,
        fromItemId,
        fromFindingKey,
        toItemId,
        toFindingKey,
        keysBefore,
        moved,
        patchItemPhotos,
    } = d;
    if (moved.length === 0) return;
    const movedKeys = new Set(moved.map((m) => m.entry.key));

    // local: re-insert at original index in source (ascending), filter from target
    const sorted = [...moved].sort((a, b) => a.index - b.index);
    patchItemPhotos(fromItemId, (list) => {
        const next = [...list];
        for (const mv of sorted) {
            if (next.some((p) => p.key === mv.entry.key)) continue;
            const idx = Math.min(mv.index, next.length);
            next.splice(idx, 0, mv.entry);
        }
        return next;
    });
    patchItemPhotos(toItemId, (list) => list.filter((p) => !movedKeys.has(p.key)));

    if (collabDoc && fromFindingKey && toFindingKey) {
        for (const mv of moved) {
            movePhoto(collabDoc, toFindingKey, fromFindingKey, mv.entry.key);
        }
        bindingReorderPhotos(collabDoc, fromFindingKey, keysBefore);
    }
}

/**
 * Bulk-move photos by index to another item and return a way back.
 *
 * The doc is keyed by photo `key`, not index (indices drift as entries are
 * removed), so index→key is resolved from the PRE-mutation `snapshot`. The undo
 * moves each key back and reorders the source to its pre-move key order: photo
 * order is report order. Returns undefined when no index resolved to a photo.
 */
export function movePhotosWithUndo(d: MovePhotosWithUndoDeps): (() => void) | undefined {
    const {
        collabDoc,
        fromItemId,
        fromFindingKey,
        toItemId,
        toFindingKey,
        snapshot,
        indices,
        patchItemPhotos,
    } = d;
    const moved = indices
        .map((i) => ({ index: i, entry: snapshot[i] as PhotoEntry | undefined }))
        .filter((m): m is { index: number; entry: PhotoEntry } => !!m.entry?.key);
    if (moved.length === 0) return undefined;
    const keysBefore = snapshot.map((p) => p.key);
    const keys = moved.map((m) => m.entry.key);
    patchItemPhotos(fromItemId, (photos) => photos.filter((_, i) => !indices.includes(i)));
    if (collabDoc && fromFindingKey && toFindingKey) {
        for (const key of keys) movePhoto(collabDoc, fromFindingKey, toFindingKey, key);
    }
    const undo = () =>
        restoreMovedPhotos({
            collabDoc,
            fromItemId,
            fromFindingKey,
            toItemId,
            toFindingKey,
            keysBefore,
            moved: [...moved].sort((a, b) => a.index - b.index),
            patchItemPhotos,
        });
    return undo;
}
