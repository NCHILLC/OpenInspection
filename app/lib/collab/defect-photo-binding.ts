/**
 * Doc write helpers for a DEFECT's own photos[] — crop/annotate/remove/revert.
 *
 * `addPhotoToCannedDefect` / `addPhotoToCustomDefect` (results-binding.ts)
 * moved here from results-binding.ts, which was at its file-size cap; with the
 * add path, the offline pending-add and the crop/annotate/remove/revert
 * lifecycle in one place, every write to a defect's photos[] now lives in one
 * file. This is the rest of the per-photo
 * lifecycle (view + annotate, Task: defect photos view+annotate), split out
 * because results-binding.ts is at its file-size cap. Mirrors the item-photo
 * equivalents in results-binding.ts (setPhotoCrop / setPhotoAnnotation /
 * removePhoto / revertPhoto) but resolves into a defect's sub-array instead
 * of the finding's own `photos[]`.
 */

import type * as Y from 'yjs';
import { upsertCanned, upsertCustomComment } from '../../../server/lib/collab/results-doc';
import type { PhotoEntry } from '../../../server/lib/collab/results-doc.types';
import { findingKey } from '../../../server/lib/finding-key';
import { readResultMap } from './results-binding';

export type DefectRef = { kind: 'canned' | 'custom'; id: string };

type RawPhoto = { key: string } & Record<string, unknown>;

/** Read-modify-write a defect's own photos[] via the tab-generic upsert —
 *  the same replace-whole-array pattern `addPhotoToCannedDefect` uses. */
function patchDefectPhotos(
    doc: Y.Doc,
    findingKey: string,
    ref: DefectRef,
    transform: (photos: RawPhoto[]) => RawPhoto[],
): void {
    const entry = readResultMap(doc)[findingKey];
    if (!entry) return;
    if (ref.kind === 'canned') {
        const tabs = entry.tabs as { defects?: Array<{ cannedId: string; photos?: RawPhoto[] }> } | undefined;
        const defect = tabs?.defects?.find((d) => d.cannedId === ref.id);
        if (!defect) return;
        upsertCanned(doc, findingKey, 'defects', { cannedId: ref.id, photos: transform(defect.photos ?? []) });
    } else {
        const cc = entry.customComments as { defects?: Array<{ id: string; photos?: RawPhoto[] }> } | undefined;
        const defect = cc?.defects?.find((d) => d.id === ref.id);
        if (!defect) return;
        upsertCustomComment(doc, findingKey, 'defects', { id: ref.id, photos: transform(defect.photos ?? []) });
    }
}

/** Mirror a server crop bake into a defect's photos[]. Sequential layering:
 *  drops any prior annotation (its coords were in the OLD cropped space). */
export function setDefectPhotoCrop(
    doc: Y.Doc,
    findingKey: string,
    ref: DefectRef,
    key: string,
    croppedKey: string,
    crop: PhotoEntry['crop'],
    baseEntry: PhotoEntry,
): void {
    const { annotatedKey: _a, annotationsJson: _j, ...keep } = baseEntry;
    void _a; void _j;
    const next: RawPhoto = { ...keep, key, croppedKey, crop };
    patchDefectPhotos(doc, findingKey, ref, (photos) => photos.map((p) => (p.key === key ? next : p)));
}

/** Mirror a server annotation bake into a defect's photos[]. Additive — never clears the crop. */
export function setDefectPhotoAnnotation(
    doc: Y.Doc,
    findingKey: string,
    ref: DefectRef,
    key: string,
    annotatedKey: string,
    annotationsJson: string,
): void {
    patchDefectPhotos(doc, findingKey, ref, (photos) =>
        photos.map((p) => (p.key === key ? { ...p, annotatedKey, annotationsJson } : p)));
}

/** Detach (delete) a photo from a defect's photos[], by original key. */
export function removeDefectPhoto(doc: Y.Doc, findingKey: string, ref: DefectRef, key: string): void {
    patchDefectPhotos(doc, findingKey, ref, (photos) => photos.filter((p) => p.key !== key));
}

/** Revert a defect photo to its original key, stripping crop/annotation derivatives. */
export function revertDefectPhoto(doc: Y.Doc, findingKey: string, ref: DefectRef, key: string): void {
    patchDefectPhotos(doc, findingKey, ref, (photos) => photos.map((p) => (p.key === key ? { key } : p)));
}

/**
 * Is `photo` already in `existing`?
 *
 * Dedup is by `key`, which is right for an uploaded photo and WRONG for a
 * pending offline one: every pending entry carries `key: ''` until the drain
 * swaps in its R2 key, so a plain key match declares the second photo of a
 * defect a duplicate of the first and silently drops it. Shoot three frames at
 * one defect in a crawlspace and two vanish. Pending entries are therefore
 * deduped by `pendingId`, which is a fresh UUID per capture.
 */
function isDuplicatePhoto(
    existing: ReadonlyArray<{ key: string } & Record<string, unknown>>,
    photo: { key: string } & Record<string, unknown>,
): boolean {
    if (photo.key === '' && photo.pendingId !== undefined) {
        return existing.some((p) => p.pendingId === photo.pendingId);
    }
    return existing.some((p) => p.key === photo.key);
}

/**
 * Append a photo to a canned defect's photos array (dedup — see
 * `isDuplicatePhoto`).
 * Reads the current defect state from the live doc, then replaces the photos
 * array wholesale via upsertCanned — element-level LWW is the documented
 * behavior for a defect's photos sub-array (Task 7p).
 * No-ops if the canned defect with `cannedId` is not found.
 */
export function addPhotoToCannedDefect(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    cannedId: string,
    photo: { key: string } & Record<string, unknown>,
    unitId: string | null = null,
): void {
    const fk = findingKey(unitId, sectionId, itemId);
    const entry = readResultMap(doc)[fk];
    if (!entry) return;

    const tabs = entry.tabs as {
        defects?: Array<{ cannedId: string; photos?: Array<{ key: string } & Record<string, unknown>> }>;
    } | undefined;

    const defect = tabs?.defects?.find((d) => d.cannedId === cannedId);
    if (!defect) return;

    const existing: Array<{ key: string } & Record<string, unknown>> = defect.photos ?? [];
    if (isDuplicatePhoto(existing, photo)) return;

    const nextPhotos = [...existing, photo];
    upsertCanned(doc, fk, 'defects', { cannedId, photos: nextPhotos });
}

/**
 * Append a photo to a custom defect's photos array (dedup by key).
 * Reads the current custom defect state from the live doc, then replaces the
 * photos array wholesale via upsertCustomComment.
 * No-ops if the custom defect with `customId` is not found.
 */
export function addPhotoToCustomDefect(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    customId: string,
    photo: { key: string } & Record<string, unknown>,
    unitId: string | null = null,
): void {
    const fk = findingKey(unitId, sectionId, itemId);
    const entry = readResultMap(doc)[fk];
    if (!entry) return;

    const customComments = entry.customComments as {
        defects?: Array<{ id: string; photos?: Array<{ key: string } & Record<string, unknown>> }>;
    } | undefined;

    const defect = customComments?.defects?.find((d) => d.id === customId);
    if (!defect) return;

    const existing: Array<{ key: string } & Record<string, unknown>> = defect.photos ?? [];
    if (isDuplicatePhoto(existing, photo)) return;

    const nextPhotos = [...existing, photo];
    upsertCustomComment(doc, fk, 'defects', { id: customId, photos: nextPhotos });
}

/**
 * #181 PR-G — append a brand-new OFFLINE photo to a defect row as a PENDING
 * entry. The defect-row mirror of `appendPendingPhoto`.
 *
 * The bytes live only in the local media-pending store until the drain runs, so
 * the entry carries an empty `key` + `pendingUpload` + the `pendingId` that
 * resolves to the local blob — the same shape the item path already uses, which
 * is why the strip renders it and the report skips it with no new cases.
 *
 * Takes sectionId/itemId rather than this module's usual findingKey because it
 * delegates to the two add helpers, which own the dedup and the "no such defect
 * row" no-op; re-deriving their key here would only add a way to disagree.
 */
export function appendPendingPhotoToDefect(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    ref: DefectRef,
    pendingId: string,
    unitId: string | null = null,
): void {
    const photo = {
        key: '',
        pendingUpload: true,
        pendingId,
        pendingKind: 'photo',
        mediaType: 'photo',
    };
    if (ref.kind === 'canned') {
        addPhotoToCannedDefect(doc, sectionId, itemId, ref.id, photo, unitId);
    } else {
        addPhotoToCustomDefect(doc, sectionId, itemId, ref.id, photo, unitId);
    }
}

/**
 * #181 PR-G — swap a pending defect photo to its real R2 key once the drain has
 * uploaded it. The defect-row mirror of `resolvePendingPhoto`.
 *
 * Addressed by `pendingId`, never by `key`, for the same reason as the item
 * path: every pending entry's key is the empty string until this runs, so two
 * offline captures on one defect are indistinguishable by key.
 *
 * A no-op when the row was deleted while the photo sat in the queue —
 * `patchDefectPhotos` bails on a missing defect. The drain still drops the
 * record: the bytes reached R2, and re-queueing a photo with nowhere to land
 * would retry forever and wedge the queue behind it.
 */
export function resolvePendingDefectPhoto(
    doc: Y.Doc,
    findingKey: string,
    ref: DefectRef,
    pendingId: string,
    key: string,
): void {
    patchDefectPhotos(doc, findingKey, ref, (photos) =>
        photos.map((p) => {
            if (p.pendingId !== pendingId) return p;
            const { pendingUpload: _u, pendingId: _p, pendingKind: _k, ...keep } = p;
            void _u; void _p; void _k;
            return { ...keep, key };
        }));
}
