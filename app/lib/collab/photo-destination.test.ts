// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { seedResultsDoc, appendPhoto, pushPendingPhoto, upsertCanned, upsertCustomComment, projectResults } from '../../../server/lib/collab/results-doc';
import { resolvePendingDefectPhoto } from './defect-photo-binding';
import { resolvePendingPhoto } from './results-binding';
import { movePhotoEntries, photosAt, pendingPhotoAddress, rememberPendingMediaUpload } from './photo-destination';
vi.mock('./media-pending-store', () => ({ rebindPendingMedia: vi.fn(async () => {}) }));
const from = { findingKey: 'u:s:i' };
const other = { findingKey: 'u:s:j' };
function setup(kind: 'canned' | 'custom') {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [from, other, { findingKey: 'v:s:i' }]);
    if (kind === 'canned') upsertCanned(doc, from.findingKey, 'defects', { cannedId: 'd', included: true });
    else upsertCustomComment(doc, from.findingKey, 'defects', { id: 'd', included: true, title: 'Leak' });
    return { doc, to: { ...from, defectTarget: { kind, id: 'd' } } };
}
describe.each(['canned', 'custom'] as const)('%s photo destinations', kind => {
    it('moves complete derivatives into the report projection and undoes once without replacing other photos', () => {
        const { doc, to } = setup(kind);
        const photo = { key: 'a', croppedKey: 'crop', annotatedKey: 'ink', annotationsJson: '[]' };
        appendPhoto(doc, from.findingKey, photo);
        const undo = movePhotoEntries(doc, from, to, [photo, photo])!;
        expect(photosAt(doc, from)).toEqual([]);
        expect(photosAt(doc, to)).toEqual([photo]);
        expect(JSON.stringify(projectResults(doc))).toContain('"annotatedKey":"ink"');
        appendPhoto(doc, from.findingKey, { key: 'new' });
        undo(); undo();
        expect(photosAt(doc, from)).toEqual([photo, { key: 'new' }]);
        expect(photosAt(doc, to)).toEqual([]);
        expect(photosAt(doc, { findingKey: 'v:s:i' })).toEqual([]);
    });
    it.each([true, false])('resolves upload completion before Undo=%s at the live destination', before => {
        const { doc, to } = setup(kind);
        const pending = { key: '', pendingId: 'p', pendingUpload: true, pendingKind: 'photo' as const };
        pushPendingPhoto(doc, from.findingKey, pending);
        const undo = movePhotoEntries(doc, from, to, [pending])!;
        if (!before) undo();
        const address = pendingPhotoAddress(doc, 'p')!;
        rememberPendingMediaUpload(doc, 'p', { key: 'uploaded' });
        if (address.defectTarget) resolvePendingDefectPhoto(doc, address.findingKey, address.defectTarget, 'p', 'uploaded');
        else resolvePendingPhoto(doc, address.findingKey, 'p', 'photo', undefined, { key: 'uploaded' });
        if (before) undo();
        expect(photosAt(doc, from)).toEqual([{ key: 'uploaded' }]);
        expect(photosAt(doc, to)).toEqual([]);
        expect(pendingPhotoAddress(doc, 'p')).toBeUndefined();
    });
    it('refuses a stale or excluded defect before removing any source photo', () => {
        const { doc, to } = setup(kind);
        appendPhoto(doc, from.findingKey, { key: 'a' });
        if (kind === 'canned') upsertCanned(doc, from.findingKey, 'defects', { cannedId: 'd', included: false });
        else upsertCustomComment(doc, from.findingKey, 'defects', { id: 'd', included: false });
        expect(movePhotoEntries(doc, from, to, [{ key: 'a' }])).toBeUndefined();
        expect(movePhotoEntries(doc, from, { ...to, defectTarget: { kind, id: 'gone' } }, [{ key: 'a' }])).toBeUndefined();
        expect(photosAt(doc, from)).toEqual([{ key: 'a' }]);
    });
    it('keeps pending identities distinct across reload and repeated actions', () => {
        const { doc, to } = setup(kind);
        const pending = { key: '', pendingId: 'p', pendingUpload: true };
        pushPendingPhoto(doc, from.findingKey, pending);
        pushPendingPhoto(doc, from.findingKey, { ...pending, pendingId: 'q' });
        movePhotoEntries(doc, from, to, [pending]);
        expect(movePhotoEntries(doc, from, to, [pending])).toBeUndefined();
        const restored = new Y.Doc(); Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
        expect(pendingPhotoAddress(restored, 'p')).toEqual(to);
        expect(photosAt(restored, from).map(p => p.pendingId)).toEqual(['q']);
    });
    it('does not discard source derivatives when the destination already has the same photo', () => {
        const { doc } = setup(kind);
        appendPhoto(doc, from.findingKey, { key: 'same', annotatedKey: 'source-ink' });
        appendPhoto(doc, other.findingKey, { key: 'same', annotatedKey: 'target-ink' });
        expect(movePhotoEntries(doc, from, other, [{ key: 'same' }])).toBeUndefined();
        expect(photosAt(doc, from)).toEqual([{ key: 'same', annotatedKey: 'source-ink' }]);
        expect(photosAt(doc, other)).toEqual([{ key: 'same', annotatedKey: 'target-ink' }]);
    });

    it('Undo recovers the photo when the destination defect is concurrently removed', () => {
        const { doc, to } = setup(kind);
        const photo = { key: 'a', croppedKey: 'crop', annotatedKey: 'ink' };
        appendPhoto(doc, from.findingKey, photo);
        const undo = movePhotoEntries(doc, from, to, [photo])!;
        const item = doc.getMap<Y.Map<unknown>>('results').get(from.findingKey)!;
        const group = item.get(kind === 'canned' ? 'tabs' : 'customComments') as Y.Map<unknown>;
        (group.get('defects') as Y.Array<unknown>).delete(0, 1);
        undo();
        expect(photosAt(doc, from)).toEqual([photo]);
        expect(photosAt(doc, to)).toEqual([]);
    });

});
