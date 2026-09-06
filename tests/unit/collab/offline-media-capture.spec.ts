// @vitest-environment happy-dom
/**
 * #181 PR-G — offline media capture → pending doc entry → drain → swap.
 *
 * Exercises the wiring layer added in Task G2 directly against a Y.Doc + the
 * offline media queue (fake-indexeddb, no server):
 *   - appendPendingPhoto writes a pending entry (empty key + pendingUpload).
 *   - markPhotoPending marks an existing photo's offline crop/annotate (keeps key).
 *   - a stubbed drain (resolvePendingPhoto as onUploaded) swaps the entry to the
 *     real R2 key and clears the pending markers.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
    seedResultsDoc,
    projectResults,
    appendPhoto,
} from '../../../server/lib/collab/results-doc';
import {
    appendPendingPhoto,
    markPhotoPending,
    resolvePendingPhoto,
    toggleCanned,
} from '../../../app/lib/collab/results-binding';
import {
    appendPendingPhotoToDefect,
    resolvePendingDefectPhoto,
} from '../../../app/lib/collab/defect-photo-binding';
import {
    enqueueMedia,
    drainMediaQueue,
    type MediaUploader,
} from '../../../app/lib/collab/media-upload-queue';
import {
    listPendingMedia,
    deletePendingMedia,
} from '../../../app/lib/collab/media-pending-store';

const FK = '_default:s1:i1';

async function clearStore(): Promise<void> {
    const all = await listPendingMedia();
    for (const r of all) await deletePendingMedia(r.pendingId);
}

beforeEach(async () => {
    await clearStore();
});

function freshDoc(): Y.Doc {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    return doc;
}

function photos(doc: Y.Doc): NonNullable<ReturnType<typeof projectResults>[string]['photos']> {
    return projectResults(doc)[FK].photos ?? [];
}

describe('offline photo ADD → pending entry → drain swaps to real key', () => {
    it('appends a pending entry, enqueues the blob, then drain resolves it', async () => {
        const doc = freshDoc();
        const pendingId = 'pid-photo-1';
        const blob = new Blob(['photo-bytes'], { type: 'image/jpeg' });

        // Offline capture: enqueue + write the pending doc entry.
        await enqueueMedia({
            pendingId,
            inspectionId: 'insp-1',
            findingKey: FK,
            kind: 'photo',
            blob,
            enqueuedAt: Date.now(),
        });
        appendPendingPhoto(doc, FK, pendingId);

        // The doc holds a pending entry: empty key + pendingUpload + pendingId.
        const before = photos(doc);
        expect(before).toHaveLength(1);
        expect(before[0].key).toBe('');
        expect(before[0].pendingUpload).toBe(true);
        expect(before[0].pendingId).toBe(pendingId);
        expect(before[0].pendingKind).toBe('photo');

        // The report (pendingUpload filter) would skip it — assert the marker.
        expect(before[0].pendingUpload).toBe(true);

        // Drain with a stub uploader; resolvePendingPhoto is the onUploaded swap.
        const uploader: MediaUploader = {
            upload: async () => ({ key: 'r2/real-photo-key' }),
        };
        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader,
            onUploaded: (rec, result) =>
                resolvePendingPhoto(doc, rec.findingKey, rec.pendingId, rec.kind, rec.photoKey, result),
        });

        expect(summary).toEqual({ uploaded: 1, failed: 0 });

        // The entry is swapped to the real key with all pending markers cleared.
        const after = photos(doc);
        expect(after).toHaveLength(1);
        expect(after[0].key).toBe('r2/real-photo-key');
        expect(after[0].pendingUpload).toBeUndefined();
        expect(after[0].pendingId).toBeUndefined();
        expect(after[0].pendingKind).toBeUndefined();

        // The local blob was drained out of the store.
        expect(await listPendingMedia('insp-1')).toHaveLength(0);
    });

    it('two concurrent offline adds resolve independently (matched by pendingId)', async () => {
        const doc = freshDoc();
        await enqueueMedia({ pendingId: 'A', inspectionId: 'insp-1', findingKey: FK, kind: 'photo', blob: new Blob(['a']), enqueuedAt: 1 });
        await enqueueMedia({ pendingId: 'B', inspectionId: 'insp-1', findingKey: FK, kind: 'photo', blob: new Blob(['b']), enqueuedAt: 2 });
        appendPendingPhoto(doc, FK, 'A');
        appendPendingPhoto(doc, FK, 'B');

        // Both pending entries have an empty key; the swap must match by pendingId.
        const uploader: MediaUploader = {
            upload: async (rec) => ({ key: `r2/${rec.pendingId}` }),
        };
        await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader,
            onUploaded: (rec, result) =>
                resolvePendingPhoto(doc, rec.findingKey, rec.pendingId, rec.kind, rec.photoKey, result),
        });

        const keys = photos(doc).map((p) => p.key).sort();
        expect(keys).toEqual(['r2/A', 'r2/B']);
        expect(photos(doc).every((p) => !p.pendingId)).toBe(true);
    });
});

describe('offline CROP of an existing photo → keeps base key, drain sets croppedKey', () => {
    it('marks pending-crop without pendingUpload, then drain swaps in croppedKey', async () => {
        const doc = freshDoc();
        appendPhoto(doc, FK, { key: 'r2/base.jpg', mediaType: 'photo' });

        const pendingId = 'pid-crop-1';
        const crop = { aspect: '3:2', orientation: 'landscape' as const, x: 0, y: 0, width: 100, height: 66 };
        await enqueueMedia({
            pendingId,
            inspectionId: 'insp-1',
            findingKey: FK,
            kind: 'crop',
            blob: new Blob(['cropped']),
            photoKey: 'r2/base.jpg',
            crop,
            enqueuedAt: Date.now(),
        });
        markPhotoPending(doc, FK, 'r2/base.jpg', pendingId, 'crop', { crop });

        // Base key kept (report still serves it); NO pendingUpload set.
        const before = photos(doc)[0];
        expect(before.key).toBe('r2/base.jpg');
        expect(before.pendingUpload).toBeUndefined();
        expect(before.pendingId).toBe(pendingId);
        expect(before.pendingKind).toBe('crop');
        expect(before.crop).toEqual(crop);

        const uploader: MediaUploader = {
            upload: async () => ({ croppedKey: 'r2/base-cropped.jpg' }),
        };
        await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader,
            onUploaded: (rec, result) =>
                resolvePendingPhoto(doc, rec.findingKey, rec.pendingId, rec.kind, rec.photoKey, result),
        });

        const after = photos(doc)[0];
        expect(after.key).toBe('r2/base.jpg');
        expect(after.croppedKey).toBe('r2/base-cropped.jpg');
        expect(after.pendingId).toBeUndefined();
        expect(after.pendingKind).toBeUndefined();
        expect(after.crop).toEqual(crop);
    });
});

describe('offline ANNOTATE of an existing photo → keeps base/cropped key', () => {
    it('marks pending-annotate, then drain swaps in annotatedKey', async () => {
        const doc = freshDoc();
        appendPhoto(doc, FK, { key: 'r2/base.jpg', croppedKey: 'r2/base-cropped.jpg' });

        const pendingId = 'pid-anno-1';
        const nodesJson = '[{"type":"rect"}]';
        await enqueueMedia({
            pendingId,
            inspectionId: 'insp-1',
            findingKey: FK,
            kind: 'annotate',
            blob: new Blob(['annotated']),
            photoKey: 'r2/base.jpg',
            nodesJson,
            enqueuedAt: Date.now(),
        });
        markPhotoPending(doc, FK, 'r2/base.jpg', pendingId, 'annotate', { annotationsJson: nodesJson });

        const before = photos(doc)[0];
        expect(before.key).toBe('r2/base.jpg');
        expect(before.croppedKey).toBe('r2/base-cropped.jpg'); // crop survives annotate
        expect(before.pendingUpload).toBeUndefined();
        expect(before.pendingKind).toBe('annotate');
        expect(before.annotationsJson).toBe(nodesJson);

        const uploader: MediaUploader = {
            upload: async () => ({ annotatedKey: 'r2/base-annotated.png' }),
        };
        await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader,
            onUploaded: (rec, result) =>
                resolvePendingPhoto(doc, rec.findingKey, rec.pendingId, rec.kind, rec.photoKey, result),
        });

        const after = photos(doc)[0];
        expect(after.key).toBe('r2/base.jpg');
        expect(after.croppedKey).toBe('r2/base-cropped.jpg');
        expect(after.annotatedKey).toBe('r2/base-annotated.png');
        expect(after.pendingId).toBeUndefined();
        expect(after.pendingKind).toBeUndefined();
    });
});

/**
 * The 2026-09-06 field-eval P0: a photo added to a DEFECT ROW offline crashed
 * the editor and was lost, because that path skipped the queue entirely and
 * POSTed to a dead network. It now takes the same queue as an item photo — so
 * the same three properties have to hold, one array deeper.
 */
describe('offline DEFECT photo ADD → pending entry → drain swaps to real key', () => {
    /** Photos on one canned defect row, as the projection exposes them. */
    function defectPhotos(doc: Y.Doc, cannedId: string): Array<Record<string, unknown>> {
        const tabs = projectResults(doc)[FK].tabs as
            | { defects?: Array<{ cannedId: string; photos?: Array<Record<string, unknown>> }> }
            | undefined;
        return tabs?.defects?.find((d) => d.cannedId === cannedId)?.photos ?? [];
    }

    /** A doc with one canned defect included on the item — nothing to add to otherwise. */
    function docWithDefect(cannedId: string): Y.Doc {
        const doc = freshDoc();
        toggleCanned(doc, 's1', 'i1', 'defects', cannedId, true);
        return doc;
    }

    it('lands the pending entry on the DEFECT, not the item, and drain swaps it', async () => {
        const doc = docWithDefect('d1');
        const pendingId = 'pid-defect-1';
        const target = { kind: 'canned' as const, id: 'd1' };

        await enqueueMedia({
            pendingId,
            inspectionId: 'insp-1',
            findingKey: FK,
            defectTarget: target,
            kind: 'photo',
            blob: new Blob(['defect-bytes'], { type: 'image/jpeg' }),
            enqueuedAt: Date.now(),
        });
        appendPendingPhotoToDefect(doc, 's1', 'i1', target, pendingId);

        const before = defectPhotos(doc, 'd1');
        expect(before).toHaveLength(1);
        expect(before[0].key).toBe('');
        expect(before[0].pendingUpload).toBe(true);
        expect(before[0].pendingId).toBe(pendingId);
        // The item's own strip must NOT have gained a photo — a defect photo
        // showing on the item is the exact mis-filing the hook tests guard.
        expect(photos(doc)).toHaveLength(0);

        const uploader: MediaUploader = { upload: async () => ({ key: 'r2/defect-key' }) };
        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader,
            onUploaded: (rec, result) =>
                resolvePendingDefectPhoto(doc, rec.findingKey, rec.defectTarget!, rec.pendingId, result.key!),
        });

        expect(summary).toEqual({ uploaded: 1, failed: 0 });
        const after = defectPhotos(doc, 'd1');
        expect(after).toHaveLength(1);
        expect(after[0].key).toBe('r2/defect-key');
        expect(after[0].pendingUpload).toBeUndefined();
        expect(after[0].pendingId).toBeUndefined();
        expect(after[0].pendingKind).toBeUndefined();
        expect(await listPendingMedia('insp-1')).toHaveLength(0);
    });

    /**
     * Three frames at one defect. The append dedups by `key`, and every pending
     * key is the empty string until the drain runs — so a plain key match called
     * frames 2 and 3 duplicates of frame 1 and dropped them on the floor.
     */
    it('keeps all three frames of a defect capture session', async () => {
        const doc = docWithDefect('d1');
        const target = { kind: 'canned' as const, id: 'd1' };

        for (const id of ['A', 'B', 'C']) {
            await enqueueMedia({
                pendingId: id,
                inspectionId: 'insp-1',
                findingKey: FK,
                defectTarget: target,
                kind: 'photo',
                blob: new Blob([id]),
                enqueuedAt: Date.now(),
            });
            appendPendingPhotoToDefect(doc, 's1', 'i1', target, id);
        }

        expect(defectPhotos(doc, 'd1')).toHaveLength(3);

        const uploader: MediaUploader = { upload: async (rec) => ({ key: `r2/${rec.pendingId}` }) };
        await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader,
            onUploaded: (rec, result) =>
                resolvePendingDefectPhoto(doc, rec.findingKey, rec.defectTarget!, rec.pendingId, result.key!),
        });

        const keys = defectPhotos(doc, 'd1').map((p) => p.key).sort();
        expect(keys).toEqual(['r2/A', 'r2/B', 'r2/C']);
        expect(defectPhotos(doc, 'd1').every((p) => !p.pendingId)).toBe(true);
    });

    it('leaves the queue clean when the defect row was deleted mid-queue', async () => {
        const doc = docWithDefect('d1');
        const target = { kind: 'canned' as const, id: 'gone' };
        await enqueueMedia({
            pendingId: 'orphan',
            inspectionId: 'insp-1',
            findingKey: FK,
            defectTarget: target,
            kind: 'photo',
            blob: new Blob(['x']),
            enqueuedAt: Date.now(),
        });

        // The row is not in the doc, so the swap has nowhere to land. The record
        // must still drain — the bytes reached R2, and re-queueing it forever is
        // how a queue wedges and stops draining the photos that DO have a home.
        const uploader: MediaUploader = { upload: async () => ({ key: 'r2/orphan' }) };
        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            uploader,
            onUploaded: (rec, result) =>
                resolvePendingDefectPhoto(doc, rec.findingKey, rec.defectTarget!, rec.pendingId, result.key!),
        });

        expect(summary).toEqual({ uploaded: 1, failed: 0 });
        expect(await listPendingMedia('insp-1')).toHaveLength(0);
    });
});
