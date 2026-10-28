import { buildPendingMediaUploader } from "~/lib/collab/pending-media-uploader";
import { pendingPhotoAddress, rememberPendingMediaUpload } from '~/lib/collab/photo-destination';
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
 * Baked pending derivatives use the binary upload door, so moving between
 * buckets or units does not depend on the D1 projection's old photo index.
 */

import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
    drainMediaQueue,
} from '~/lib/collab/media-upload-queue';
import { listPendingMedia } from '~/lib/collab/media-pending-store';
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
import { resolvePendingDefectPhoto, resolvePendingDefectDerivative } from '~/lib/collab/defect-photo-binding';

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
        const uploader = buildPendingMediaUploader(inspectionId, liveDoc);
        void drainMediaQueue({
            inspectionId,
            uploader,
            onUploaded: (rec, result) => {
                const live = pendingPhotoAddress(liveDoc, rec.pendingId);
                if (live) rec = { ...rec, ...live, defectTarget: live.defectTarget };
                rememberPendingMediaUpload(liveDoc, rec.pendingId, result);
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
                } else if (rec.defectTarget) {
                    resolvePendingDefectDerivative(liveDoc, rec.findingKey, rec.defectTarget, rec.pendingId, result);
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
