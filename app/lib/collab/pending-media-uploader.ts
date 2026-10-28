import type * as Y from 'yjs';
import type { MediaUploader } from './media-upload-queue';
import { pendingPhotoAddress } from './photo-destination';

/** Pending derivatives already contain baked bytes. The binary upload door avoids
 * index-based bake routes reading an old D1 projection after a move (or another unit). */
export function buildPendingMediaUploader(inspectionId: string, doc: Y.Doc): MediaUploader {
    return {
        async upload(rec) {
            const live = pendingPhotoAddress(doc, rec.pendingId);
            if (!live) throw new Error('pending photo no longer present');
            const fd = new FormData();
            const isAnnotation = rec.kind === 'annotate';
            fd.append('file', new File([rec.blob], isAnnotation ? 'annotated.png' : 'photo.jpg', {
                type: rec.blob.type || (isAnnotation ? 'image/png' : 'image/jpeg'),
            }));
            fd.append('itemId', live.findingKey.split(':').at(-1) ?? '');
            const res = await fetch(`/api/inspections/${inspectionId}/upload`, {
                method: 'POST', credentials: 'include', body: fd,
            });
            if (!res.ok) throw new Error(`upload failed: ${res.status}`);
            const body = await res.json() as { data?: { key?: string } };
            const key = body.data?.key;
            if (!key) throw new Error('upload returned no key');
            return rec.kind === 'crop' ? { croppedKey: key }
                : rec.kind === 'annotate' ? { annotatedKey: key } : { key };
        },
    };
}
