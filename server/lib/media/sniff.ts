/**
 * Decide an upload's real type from its first bytes. The declared Content-Type is client controlled, so a
 * client could store anything under an image key by labelling it; this looks at the file itself. Pure and
 * bounded: callers pass at most `HEAD_BYTES` bytes (see `headBytes`), never the whole body.
 * The HEIF rule mirrors `looksLikeHeif` in packages/field-ui (browser side, async on a Blob).
 */
import { Errors } from '../errors';

const HEAD_BYTES = 64;

/** The raster types a photo may be stored as, and the only ones served inline. */
export type PhotoType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
export const PHOTO_TYPES: readonly PhotoType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/** The leading bytes of an upload, read without buffering the rest. */
async function headBytes(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
}

const text = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));
const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

/**
 * The `ftyp` brands of an ISO base media file (major first, then the compatible list), or null when it is not one.
 * The box's own size field bounds the compatible brands; a size of 0 or 1, one under 12 or one past the window
 * means only the bytes inside the window are read.
 */
function ftypBrands(b: Uint8Array): string[] | null {
    if (b.length < 12 || text(b, 4) !== 'ftyp') return null;
    const size = ((b[0] ?? 0) * 0x1000000) + ((b[1] ?? 0) << 16) + ((b[2] ?? 0) << 8) + (b[3] ?? 0);
    const end = size >= 12 && size <= b.length ? size : b.length;
    const brands = [text(b, 8)];
    for (let at = 16; at + 4 <= end; at += 4) brands.push(text(b, at));
    return brands;
}

/** jpeg, png, webp or heic by magic number; null for anything else (AVIF, SVG and GIF included). */
function sniffPhotoType(b: Uint8Array): PhotoType | null {
    if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (b.length >= 12 && text(b, 0) === 'RIFF' && text(b, 8) === 'WEBP') return 'image/webp';
    const brands = ftypBrands(b);
    if (!brands || brands[0] === 'avif' || brands[0] === 'avis') return null; // AVIF lists mif1 as compatible
    return brands.some((brand) => HEIF_BRANDS.has(brand)) ? 'image/heic' : null;
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Refuse a photo upload that is too big, empty, or not a raster image, and return the type its bytes show.
 * The size check runs before the body is read.
 */
export async function checkPhotoUpload(file: File): Promise<PhotoType> {
    if (file.size > MAX_PHOTO_BYTES) {
        throw Errors.BadRequest(`Photo exceeds ${MAX_PHOTO_BYTES} bytes (got ${file.size})`);
    }
    if (file.size === 0) throw Errors.BadRequest('Photo is empty');
    const type = sniffPhotoType(await headBytes(file));
    if (!type) throw Errors.BadRequest('Unsupported photo type: expected a JPEG, PNG, WebP or HEIC image');
    return type;
}
