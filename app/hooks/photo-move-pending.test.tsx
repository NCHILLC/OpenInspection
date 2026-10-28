// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { seedResultsDoc, pushPendingPhoto, upsertCanned, upsertCustomComment } from '../../server/lib/collab/results-doc';
import { enqueueMedia } from '~/lib/collab/media-upload-queue';
import { getPendingMedia, rebindPendingMedia } from '~/lib/collab/media-pending-store';
import { movePhotoEntries, photosAt } from '~/lib/collab/photo-destination';
import { useMediaDrain } from './useMediaDrain';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe.each(['canned', 'custom'] as const)('pending move to %s', kind => {
  describe.each(['photo', 'crop', 'annotate'] as const)('%s upload', mediaKind => {
    it.each([true, false, "removed"] as const)('completes an in-flight upload before Undo=%s without uploading twice', async beforeUndo => {
        const doc = new Y.Doc();
        const from = { findingKey: 'u:s:i' };
        const to = { ...from, defectTarget: { kind, id: 'd' } };
        const pendingId = crypto.randomUUID();
        const inspectionId = crypto.randomUUID();
        seedResultsDoc(doc, [from]);
        if (kind === 'canned') upsertCanned(doc, from.findingKey, 'defects', { cannedId: 'd', included: true });
        else upsertCustomComment(doc, from.findingKey, 'defects', { id: 'd', included: true });
        const photo = { key: mediaKind === 'photo' ? '' : 'original', pendingUpload: true, pendingId, pendingKind: mediaKind };
        const expected = mediaKind === 'photo' ? { key: 'uploaded' } : { key: 'original', [mediaKind === 'crop' ? 'croppedKey' : 'annotatedKey']: 'uploaded' };
        await enqueueMedia({ pendingId, inspectionId, findingKey: from.findingKey, kind: mediaKind, photoKey: photo.key, blob: new Blob(['image'], { type: 'image/jpeg' }), enqueuedAt: Date.now() });
        pushPendingPhoto(doc, from.findingKey, photo);
        let finish!: (response: Response) => void;
        const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
        vi.stubGlobal('fetch', fetcher);
        const { result } = renderHook(() => useMediaDrain(inspectionId, doc));
        act(() => result.current.drain());
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        const undo = movePhotoEntries(doc, from, to, [photo])!;
        await waitFor(async () => expect((await getPendingMedia(pendingId))?.defectTarget).toEqual(to.defectTarget));
        if (beforeUndo === "removed") {
            const item = doc.getMap<Y.Map<unknown>>('results').get(from.findingKey)!;
            const group = item.get(kind === 'canned' ? 'tabs' : 'customComments') as Y.Map<unknown>;
            (group.get('defects') as Y.Array<unknown>).delete(0, 1);
        }
        if (!beforeUndo) {
            undo();
            await waitFor(async () => expect((await getPendingMedia(pendingId))?.defectTarget).toBeUndefined());
        }
        await act(async () => finish(new Response(JSON.stringify({ data: { key: 'uploaded' } }), { status: 200 })));
        if (beforeUndo === "removed") await waitFor(async () => expect(await getPendingMedia(pendingId)).toBeUndefined());
        else await waitFor(() => expect(photosAt(doc, beforeUndo ? to : from)).toEqual([expected]));
        if (beforeUndo) undo();
        await waitFor(async () => expect(await getPendingMedia(pendingId)).toBeUndefined());
        // Late rebinding must never resurrect a consumed record and its blob.
        await rebindPendingMedia(pendingId, from);
        act(() => result.current.drain());
        expect(await getPendingMedia(pendingId)).toBeUndefined();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(photosAt(doc, from)).toEqual([expected]);
        expect(photosAt(doc, to)).toEqual([]);
    });
  });
});
