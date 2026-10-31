import { describe, it, expect, vi } from 'vitest';
import { servePhotoObject } from '../../../server/lib/media/serve-photo';

function bucketWith(contentType: string | undefined): R2Bucket {
    const obj = {
        body: new Blob(['x']).stream(),
        httpMetadata: contentType ? { contentType } : {},
        customMetadata: { originalName: 'site.jpg' },
        httpEtag: '"e"',
    };
    return { get: vi.fn().mockResolvedValue(obj) } as unknown as R2Bucket;
}

describe('servePhotoObject', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])('serves a stored %s inline', async (type) => {
        const res = await servePhotoObject(bucketWith(type), undefined, 'k');
        expect(res!.headers.get('Content-Type')).toBe(type);
        expect(res!.headers.get('Content-Disposition')).toMatch(/^inline/);
        expect(res!.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it.each(['text/html', 'image/svg+xml', 'application/octet-stream', undefined])('serves a stored %s as an attachment', async (type) => {
        const res = await servePhotoObject(bucketWith(type), undefined, 'k');
        expect(res!.headers.get('Content-Disposition')).toMatch(/^attachment/);
        expect(res!.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('still honours an explicit download request for a jpeg', async () => {
        const res = await servePhotoObject(bucketWith('image/jpeg'), undefined, 'k', { download: true });
        expect(res!.headers.get('Content-Disposition')).toMatch(/^attachment/);
    });

    it('marks the thumbnail response nosniff', async () => {
        const images = { input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response('t', { headers: { 'content-type': 'image/webp' } }) }) }) }) };
        const res = await servePhotoObject(bucketWith('image/jpeg'), images as never, 'k', { width: '200' });
        expect(res!.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });
});
