/**
 * The one path every stored clip is served through (staff session route and report link route).
 *
 * The range cases are the ones players send: an open end to resume, a suffix to find the end of the file, an end past
 * the file, and a start past the file.
 */
import { describe, it, expect } from 'vitest';
import { resolveByteRange, serveVideoClip, serveVideoPoster } from '../../../server/lib/media/serve-video';

const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

function fakeBucket(objects: Record<string, { bytes: Uint8Array; type?: string }>): R2Bucket {
    return {
        head: async (key: string) => (objects[key] ? { size: objects[key]!.bytes.length } : null),
        get: async (key: string, opts?: { range?: { offset: number; length?: number } }) => {
            const o = objects[key];
            if (!o) return null;
            const r = opts?.range;
            const body = r ? o.bytes.slice(r.offset, r.length === undefined ? undefined : r.offset + r.length) : o.bytes;
            return { body, size: o.bytes.length, httpMetadata: o.type ? { contentType: o.type } : {} };
        },
    } as unknown as R2Bucket;
}

describe('resolveByteRange', () => {
    it('serves the whole object when there is no range, or one it does not serve', () => {
        expect(resolveByteRange(undefined, 10)).toBeNull();
        expect(resolveByteRange('bytes=0-1,4-5', 10)).toBeNull();
        expect(resolveByteRange('items=0-1', 10)).toBeNull();
        expect(resolveByteRange('bytes=-', 10)).toBeNull();
    });
    it('reads a closed range, an open end and a suffix', () => {
        expect(resolveByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
        expect(resolveByteRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 });
        expect(resolveByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    });
    it('clamps an end past the file and a suffix longer than the file', () => {
        expect(resolveByteRange('bytes=8-99', 10)).toEqual({ start: 8, end: 9 });
        expect(resolveByteRange('bytes=-99', 10)).toEqual({ start: 0, end: 9 });
    });
    it('refuses a start at or past the end, and an empty suffix', () => {
        expect(resolveByteRange('bytes=10-', 10)).toBe('unsatisfiable');
        expect(resolveByteRange('bytes=-0', 10)).toBe('unsatisfiable');
        expect(resolveByteRange('bytes=0-1', 0)).toBe('unsatisfiable');
    });
});

describe('serveVideoClip', () => {
    const bucket = fakeBucket({ 'a/clip.mp4': { bytes: BYTES, type: 'video/mp4' }, 'a/odd.mp4': { bytes: BYTES, type: 'text/html' } });

    it('answers 200 with the whole clip, its real length and the cache policy it was given', async () => {
        const res = (await serveVideoClip(bucket, 'a/clip.mp4', undefined, 'private, max-age=300'))!;
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Length')).toBe('10');
        expect(res.headers.get('Accept-Ranges')).toBe('bytes');
        expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    });
    it('answers 206 with exactly the requested bytes', async () => {
        const res = (await serveVideoClip(bucket, 'a/clip.mp4', 'bytes=2-5', 'private'))!;
        expect(res.status).toBe(206);
        expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10');
        expect(res.headers.get('Content-Length')).toBe('4');
        expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([2, 3, 4, 5]);
    });
    it('answers a suffix range with the last bytes', async () => {
        const res = (await serveVideoClip(bucket, 'a/clip.mp4', 'bytes=-3', 'private'))!;
        expect(res.status).toBe(206);
        expect(res.headers.get('Content-Range')).toBe('bytes 7-9/10');
    });
    it('answers 416 with the object size when the start is past the end', async () => {
        const res = (await serveVideoClip(bucket, 'a/clip.mp4', 'bytes=50-', 'private'))!;
        expect(res.status).toBe(416);
        expect(res.headers.get('Content-Range')).toBe('bytes */10');
    });
    it('is null for a missing clip, and never replays a script-capable stored type', async () => {
        expect(await serveVideoClip(bucket, 'a/none.mp4', undefined, 'private')).toBeNull();
        const odd = (await serveVideoClip(bucket, 'a/odd.mp4', undefined, 'private'))!;
        expect(odd.headers.get('Content-Type')).toBe('video/mp4');
    });
});

describe('serveVideoPoster', () => {
    const bucket = fakeBucket({ 'a/p.jpg': { bytes: BYTES, type: 'image/png' }, 'a/q.jpg': { bytes: BYTES, type: 'image/svg+xml' } });
    it('serves an allowed image type as stored and anything else as jpeg', async () => {
        expect((await serveVideoPoster(bucket, 'a/p.jpg', 'private'))!.headers.get('Content-Type')).toBe('image/png');
        expect((await serveVideoPoster(bucket, 'a/q.jpg', 'private'))!.headers.get('Content-Type')).toBe('image/jpeg');
    });
    it('is null for a missing poster', async () => {
        expect(await serveVideoPoster(bucket, 'a/none.jpg', 'private')).toBeNull();
    });
});
