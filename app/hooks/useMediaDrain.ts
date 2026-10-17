/**
 * #181 PR-G — offline media drain orchestration for the inspection editor.
 *
 * Wires the offline media-upload queue (media-upload-queue.ts) to the live
 * collab Y.Doc: builds a `MediaUploader` (POST by kind to the existing R2/crop/
 * annotation endpoints) + an `onUploaded` that swaps the pending doc entry to its
 * real key, then triggers `drainMediaQueue` on each collab (re)sync and on the
 * browser `online` event. Idempotent — the queue's own in-flight guard +
 * empty-queue no-op make repeat triggers safe.
 *
 * The crop/annotate endpoints address by photoIndex, but indices shift as photos
 * are added/removed. The uploader therefore resolves the CURRENT index from the
 * doc's live photo array by the record's `photoKey` AT DRAIN TIME (not at enqueue
 * time). If the base photo has since been deleted, the upload throws and the
 * record stays queued (it will be retried on the next drain, and ultimately the
 * orphaned base never returning means it stays pending — acceptable: nothing to
 * derive from).
 */

import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
    drainMediaQueue,
    type MediaUploader,
    type UploadResult,
} from '~/lib/collab/media-upload-queue';
import { listPendingMedia, type PendingMediaRecord } from '~/lib/collab/media-pending-store';
import {
    currentConnectionType,
    gateDrain,
    onConnectionTypeChange,
    photoSyncMode,
    SYNC_NOW_EVENT,
} from '~/lib/collab/photo-sync-mode';
import { pushToast } from '~/hooks/useToast';
import { m } from '~/paraglide/messages';
import { resolvePendingPhoto } from '~/lib/collab/results-binding';
import { resolvePendingDefectPhoto } from '~/lib/collab/defect-photo-binding';
import { readResultMap } from '~/lib/collab/results-binding';
import type { PhotoEntry } from '../../server/lib/collab/results-doc.types';

/** Resolve the CURRENT index of `photoKey` in the doc's photo array for `fk`. */
function currentPhotoIndex(doc: Y.Doc, findingKey: string, photoKey: string): number {
    const entry = readResultMap(doc)[findingKey];
    const photos = (entry?.photos as PhotoEntry[] | undefined) ?? [];
    return photos.findIndex((p) => p.key === photoKey);
}

/**
 * Build a MediaUploader that POSTs each pending record to the right endpoint by
 * kind. The crop/annotate endpoints take the CURRENT photoIndex resolved from
 * the live doc. The server skips the legacy results.data write under collab
 * (skipResultsWrite is derived server-side), so the doc swap below is the only
 * write of the derivative into the results.
 */
function buildUploader(inspectionId: string, doc: Y.Doc): MediaUploader {
    return {
        async upload(rec: PendingMediaRecord): Promise<UploadResult> {
            if (rec.kind === 'photo') {
                const fd = new FormData();
                fd.append('file', new File([rec.blob], 'photo.jpg', { type: rec.blob.type || 'image/jpeg' }));
                fd.append('itemId', itemIdFromFindingKey(rec.findingKey));
                const res = await fetch(`/api/inspections/${inspectionId}/upload`, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd,
                });
                if (!res.ok) throw new Error(`upload failed: ${res.status}`);
                const body = (await res.json().catch(() => null)) as { data?: { key?: string } } | null;
                const key = body?.data?.key;
                if (!key) throw new Error('upload returned no key');
                return { key };
            }

            // crop / annotate: resolve the CURRENT photo index by base key.
            if (!rec.photoKey) throw new Error('derivative record missing photoKey');
            const index = currentPhotoIndex(doc, rec.findingKey, rec.photoKey);
            if (index < 0) throw new Error('base photo no longer present');
            const itemId = itemIdFromFindingKey(rec.findingKey);
            const sectionId = sectionIdFromFindingKey(rec.findingKey);

            if (rec.kind === 'crop') {
                const fd = new FormData();
                fd.append('image', new File([rec.blob], 'cropped.jpg', { type: 'image/jpeg' }));
                fd.append('crop', JSON.stringify(rec.crop ?? {}));
                if (sectionId) fd.append('sectionId', sectionId);
                const res = await fetch(
                    `/api/inspections/${inspectionId}/items/${itemId}/photos/${index}/crop`,
                    { method: 'POST', credentials: 'include', body: fd },
                );
                if (!res.ok) throw new Error(`crop failed: ${res.status}`);
                const body = (await res.json().catch(() => null)) as { data?: { croppedKey?: string } } | null;
                const croppedKey = body?.data?.croppedKey;
                if (!croppedKey) throw new Error('crop returned no croppedKey');
                return { croppedKey };
            }

            // annotate
            const fd = new FormData();
            fd.append('image', new File([rec.blob], 'annotated.png', { type: 'image/png' }));
            fd.append('nodes', rec.nodesJson ?? '');
            if (sectionId) fd.append('sectionId', sectionId);
            const res = await fetch(
                `/api/inspections/${inspectionId}/items/${itemId}/photos/${index}/annotation`,
                { method: 'POST', credentials: 'include', body: fd },
            );
            if (!res.ok) throw new Error(`annotation failed: ${res.status}`);
            const body = (await res.json().catch(() => null)) as { data?: { annotatedKey?: string } } | null;
            const annotatedKey = body?.data?.annotatedKey;
            if (!annotatedKey) throw new Error('annotation returned no annotatedKey');
            return { annotatedKey };
        },
    };
}

/** Composite finding key format: `_default:{sectionId}:{itemId}`. */
function itemIdFromFindingKey(findingKey: string): string {
    const parts = findingKey.split(':');
    return parts[parts.length - 1] ?? findingKey;
}

function sectionIdFromFindingKey(findingKey: string): string | undefined {
    const parts = findingKey.split(':');
    return parts.length >= 3 ? parts[parts.length - 2] : undefined;
}

/**
 * Returns a stable `drain()` callback and auto-triggers it on the browser
 * `online` event. The caller ALSO passes `drain` as the collab `onSynced` so a
 * reconnect drains the queue. No-op (collab off) when `doc` is null.
 */
export function useMediaDrain(
    inspectionId: string,
    doc: Y.Doc | null,
    revokePendingUrl?: (pendingId: string) => void,
): { drain: () => void } {
    const docRef = useRef<Y.Doc | null>(doc);
    docRef.current = doc;
    const revokeRef = useRef(revokePendingUrl);
    revokeRef.current = revokePendingUrl;

    const run = useCallback(() => {
        const liveDoc = docRef.current;
        if (!liveDoc) return;
        const uploader = buildUploader(inspectionId, liveDoc);
        void drainMediaQueue({
            inspectionId,
            uploader,
            onUploaded: (rec, result) => {
                // Swap the pending doc entry to the real key + clear pending fields.
                // A defect-scoped photo lives in that defect row's own `photos`
                // array, not the item's, so it needs the defect-row resolver —
                // `resolvePendingPhoto` reads only the item's array and would
                // find nothing to swap, stranding the entry pending forever.
                if (rec.defectTarget && rec.kind === 'photo') {
                    if (result.key) {
                        resolvePendingDefectPhoto(
                            liveDoc,
                            rec.findingKey,
                            rec.defectTarget,
                            rec.pendingId,
                            result.key,
                        );
                    }
                } else {
                    resolvePendingPhoto(
                        liveDoc,
                        rec.findingKey,
                        rec.pendingId,
                        rec.kind,
                        rec.photoKey,
                        result,
                    );
                }
                revokeRef.current?.(rec.pendingId);
            },
        });
    }, [inspectionId]);

    // Prompt once per reconnect, not once per trigger: the pill carries the
    // standing reminder, so repeat toasts would only interrupt report writing.
    const askedRef = useRef(false);

    /**
     * The automatic triggers (collab resync, `online`, a fresh capture, a
     * connection-type change) go through the sync-mode gate. Nothing is lost
     * when it holds: the blobs stay in the local queue.
     */
    const drain = useCallback(() => {
        const gate = gateDrain(photoSyncMode(), currentConnectionType(), false);
        if (gate === 'go') {
            run();
            return;
        }
        if (gate === 'wait' || askedRef.current) return;
        void listPendingMedia(inspectionId).then((rows) => {
            if (rows.length === 0 || askedRef.current) return;
            askedRef.current = true;
            pushToast({
                message: m.editor_sync_held_toast({ count: rows.length }),
                variant: 'warning',
                actionLabel: m.editor_sync_held_toast_action(),
                onAction: run,
                durationMs: 15000,
            });
        });
    }, [inspectionId, run]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onOnline = (): void => drain();
        const onOffline = (): void => { askedRef.current = false; };
        const onSyncNow = (): void => run();
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        window.addEventListener(SYNC_NOW_EVENT, onSyncNow);
        const offConn = onConnectionTypeChange(drain);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            window.removeEventListener(SYNC_NOW_EVENT, onSyncNow);
            offConn();
        };
    }, [drain, run]);

    return { drain };
}
