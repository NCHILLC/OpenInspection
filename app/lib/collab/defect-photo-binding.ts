/**
 * Doc write helpers for a DEFECT's own photos[] — crop/annotate/remove/revert.
 *
 * `addPhotoToCannedDefect` / `addPhotoToCustomDefect` (results-binding.ts)
 * already cover the "add" path; this file is the rest of the per-photo
 * lifecycle (view + annotate, Task: defect photos view+annotate), split out
 * because results-binding.ts is at its file-size cap. Mirrors the item-photo
 * equivalents in results-binding.ts (setPhotoCrop / setPhotoAnnotation /
 * removePhoto / revertPhoto) but resolves into a defect's sub-array instead
 * of the finding's own `photos[]`.
 */

import type * as Y from 'yjs';
import { upsertCanned, upsertCustomComment } from '../../../server/lib/collab/results-doc';
import type { PhotoEntry } from '../../../server/lib/collab/results-doc.types';
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
