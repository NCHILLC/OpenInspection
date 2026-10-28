import * as Y from 'yjs';
import { rebindPendingMedia } from './media-pending-store';

export type PhotoDestination = {
    itemId: string;
    sectionId?: string;
    unitId?: string | null;
    kind?: 'item';
} | {
    kind: 'defect';
    itemId: string;
    sectionId: string;
    unitId: string | null;
    defect: { kind: 'canned' | 'custom'; id: string };
};
export type PhotoMoveTarget = PhotoDestination & { label: string };
export type PhotoRecord = { key: string; pendingId?: string } & Record<string, unknown>;
export type PhotoAddress = { findingKey: string; defectTarget?: { kind: 'canned' | 'custom'; id: string } };
export const photoIdentity = (p: { key: string; pendingId?: string }): string => p.pendingId || p.key;
export const destinationIdentity = (t: PhotoDestination): string =>
    JSON.stringify([t.unitId ?? null, t.sectionId, t.itemId, t.kind === 'defect' ? t.defect : null]);

function bucket(doc: Y.Doc, at: PhotoAddress): Y.Map<unknown> | undefined {
    const item = doc.getMap<Y.Map<unknown>>('results').get(at.findingKey);
    if (!item || !at.defectTarget) return item;
    const ref = at.defectTarget;
    const tabs = item.get(ref.kind === 'canned' ? 'tabs' : 'customComments') as Y.Map<unknown>;
    const rows = tabs?.get('defects') as Y.Array<Y.Map<unknown>>;
    return rows?.toArray().find(r => r.get(ref.kind === 'canned' ? 'cannedId' : 'id') === ref.id);
}
function destinationExists(doc: Y.Doc, at: PhotoAddress, requireIncluded = false): boolean {
    const row = bucket(doc, at);
    return !!row && (!at.defectTarget || !requireIncluded || row.get('included') === true);
}
export function photosAt(doc: Y.Doc, at: PhotoAddress): PhotoRecord[] {
    const value = bucket(doc, at)?.get('photos');
    return value instanceof Y.Array ? value.toJSON() as PhotoRecord[] : (value as PhotoRecord[] | undefined) ?? [];
}
function writePhotos(doc: Y.Doc, at: PhotoAddress, next: PhotoRecord[]): void {
    const row = bucket(doc, at);
    if (!row) return;
    if (at.defectTarget) { row.set('photos', next); return; }
    const arr = row.get('photos') as Y.Array<Y.Map<unknown>>;
    // Preserve existing Y.Maps so unrelated concurrent edits keep their identity.
    for (let i = arr.length - 1; i >= 0; i--) {
        const id = photoIdentity(arr.get(i).toJSON() as PhotoRecord);
        if (!next.some(p => photoIdentity(p) === id)) arr.delete(i, 1);
    }
    next.forEach((p, i) => {
        if (arr.toArray().some(v => photoIdentity(v.toJSON() as PhotoRecord) === photoIdentity(p))) return;
        const el = new Y.Map<unknown>();
        Object.entries(p).forEach(([k, v]) => el.set(k, v));
        arr.insert(Math.min(i, arr.length), [el]);
    });
}

/** Locate by pending identity in the live doc, including after a move in another tab. */
export function pendingPhotoAddress(doc: Y.Doc, pendingId: string): PhotoAddress | undefined {
    for (const [findingKey, item] of doc.getMap<Y.Map<unknown>>('results')) {
        const at = { findingKey };
        if (photosAt(doc, at).some(p => p.pendingId === pendingId)) return at;
        for (const kind of ['canned', 'custom'] as const) {
            const tabs = item.get(kind === 'canned' ? 'tabs' : 'customComments') as Y.Map<unknown>;
            const rows = tabs?.get('defects') as Y.Array<Y.Map<unknown>>;
            for (const row of rows?.toArray() ?? []) {
                const id = row.get(kind === 'canned' ? 'cannedId' : 'id') as string;
                const dest = { findingKey, defectTarget: { kind, id } };
                if (photosAt(doc, dest).some(p => p.pendingId === pendingId)) return dest;
            }
        }
    }
}

type CompletedUpload = { key?: string; croppedKey?: string; annotatedKey?: string };
const completed = new WeakMap<Y.Doc, Map<string, CompletedUpload>>();
export function rememberPendingMediaUpload(doc: Y.Doc, pendingId: string, result: CompletedUpload): void {
    let keys = completed.get(doc);
    if (!keys) { keys = new Map(); completed.set(doc, keys); }
    keys.set(pendingId, result);
}

/** Move complete entries in one collaboration transaction. Undo reads live entries. */
export function movePhotoEntries(doc: Y.Doc, from: PhotoAddress, to: PhotoAddress,
    selected: PhotoRecord[]): (() => void) | undefined {
    if (JSON.stringify(from) === JSON.stringify(to)) return;
    if (!destinationExists(doc, from) || !destinationExists(doc, to, true)) return;
    const source = photosAt(doc, from);
    const destinationIds = new Set(photosAt(doc, to).map(photoIdentity));
    const ids = new Set(selected.map(photoIdentity).filter(id => id && !destinationIds.has(id)));
    const moved = source.map((entry, index) => ({ entry, index })).filter(v => ids.has(photoIdentity(v.entry)));
    if (!moved.length) return;
    const transfer = (src: PhotoAddress, dst: PhotoAddress, entries: Array<{ entry: PhotoRecord; index: number }>) => {
        const remaining = photosAt(doc, src);
        const target = [...photosAt(doc, dst)];
        entries = entries.filter(v => !target.some(p => photoIdentity(p) === photoIdentity(v.entry)));
        for (const { entry, index } of entries) {
            if (!target.some(p => photoIdentity(p) === photoIdentity(entry))) target.splice(Math.min(index, target.length), 0, entry);
        }
        writePhotos(doc, dst, target);
        writePhotos(doc, src, remaining.filter(p => !entries.some(v => photoIdentity(v.entry) === photoIdentity(p))));
        for (const { entry } of entries) if (entry.pendingId) void rebindPendingMedia(entry.pendingId, dst).catch(() => {});
    };
    doc.transact(() => transfer(from, to, moved.map(v => ({ ...v, index: photosAt(doc, to).length + v.index }))));
    let undone = false;
    return () => {
        if (undone || !destinationExists(doc, from)) return;
        undone = true;
        const current = photosAt(doc, to);
        const restore = moved.flatMap(v => {
            // Upload completion changes the key and clears pendingId; the drain
            // remembers the resolved key so Undo reads the latest full entry.
            const entry = current.find(p => photoIdentity(p) === photoIdentity(v.entry) || (v.entry.pendingId && p.key === (completed.get(doc)?.get(v.entry.pendingId)?.key || v.entry.key) && !!p.key));
            if (entry) return [{ entry, index: v.index }];
            // Removing the destination defect must not make Undo discard the photo.
            if (!destinationExists(doc, to)) {
                const result = v.entry.pendingId ? completed.get(doc)?.get(v.entry.pendingId) : undefined;
                if (!result) return [v];
                const { pendingId: _id, pendingUpload: _u, pendingKind: _k, ...keep } = v.entry;
                void _id; void _u; void _k;
                return [{ entry: { ...keep, ...result }, index: v.index }];
            }
            return [];
        });
        doc.transact(() => transfer(to, from, restore));
    };
}

export function pendingPhotoIds(doc: Y.Doc): Set<string> {
    const ids = new Set<string>();
    for (const item of doc.getMap<Y.Map<unknown>>('results').values()) {
        const raw = item.toJSON() as Record<string, unknown>;
        const gather = (photos: PhotoRecord[]) => photos.forEach(p => { if (p.pendingId) ids.add(p.pendingId); });
        gather((raw.photos as PhotoRecord[]) ?? []);
        for (const key of ['tabs', 'customComments']) {
            const rows = (raw[key] as { defects?: Array<{ photos?: PhotoRecord[] }> } | undefined)?.defects ?? [];
            rows.forEach(row => gather(row.photos ?? []));
        }
    }
    return ids;
}
