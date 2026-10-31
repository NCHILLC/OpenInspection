import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB, type DrizzleDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { JPEG_BYTES, PNG_BYTES, WEBP_BYTES, HEIC_BYTES, AVIF_BYTES, SVG_BYTES, HTML_BYTES, ZIP_BYTES } from '../helpers/media-bytes';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSPECTION_ID = '11111111-1111-1111-1111-111111111111';

describe('photo upload decides its type from the bytes', () => {
    let svc: InspectionService;
    const r2 = { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };

    beforeEach(async () => {
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(fixture.db);
        svc = new InspectionService({} as D1Database, r2 as unknown as R2Bucket, new ScopedDB(fixture.db as unknown as DrizzleDB, TENANT));
        r2.put.mockClear();
        await fixture.db.insert(schema.tenants).values([
            { id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await fixture.db.insert(schema.inspections).values([{
            id: INSPECTION_ID, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01', status: 'confirmed',
            paymentStatus: 'unpaid', price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        }]);
    });

    const file = (bytes: Uint8Array<ArrayBuffer> | string, name: string, type: string) => new File([bytes], name, { type });

    it.each([
        ['jpeg', JPEG_BYTES, 'image/jpeg'],
        ['png', PNG_BYTES, 'image/png'],
        ['webp', WEBP_BYTES, 'image/webp'],
        ['heic', HEIC_BYTES, 'image/heic'],
    ])('stores a %s under its sniffed type, whatever it declared', async (_n, bytes, type) => {
        await svc.uploadPhoto(INSPECTION_ID, TENANT, 'item-1', file(bytes, 'p.bin', 'application/octet-stream'));
        expect(r2.put.mock.calls[0]![2].httpMetadata.contentType).toBe(type);
        await svc.uploadPoolPhoto(INSPECTION_ID, TENANT, file(bytes, 'p.jpg', 'image/gif'));
        expect(r2.put.mock.calls[1]![2].httpMetadata.contentType).toBe(type);
    });

    it.each([
        ['html', HTML_BYTES, 'text/html'],
        ['svg', SVG_BYTES, 'image/svg+xml'],
        ['html labelled jpeg', HTML_BYTES, 'image/jpeg'],
        ['svg labelled png', SVG_BYTES, 'image/png'],
        ['avif', AVIF_BYTES, 'image/avif'],
        ['zip labelled jpeg', ZIP_BYTES, 'image/jpeg'],
    ])('refuses %s with a 400, on both upload paths', async (_n, bytes, type) => {
        await expect(svc.uploadPhoto(INSPECTION_ID, TENANT, 'item-1', file(bytes, 'x.jpg', type))).rejects.toMatchObject({ status: 400 });
        await expect(svc.uploadPoolPhoto(INSPECTION_ID, TENANT, file(bytes, 'x.jpg', type))).rejects.toMatchObject({ status: 400 });
        expect(r2.put).not.toHaveBeenCalled();
    });

    it('refuses a zero-byte file', async () => {
        await expect(svc.uploadPhoto(INSPECTION_ID, TENANT, 'item-1', file(new Uint8Array(0), 'x.jpg', 'image/jpeg'))).rejects.toMatchObject({ status: 400 });
        expect(r2.put).not.toHaveBeenCalled();
    });

    it('refuses an oversized file before reading its body', async () => {
        const big = { size: 10 * 1024 * 1024 + 1, name: 'big.jpg', type: 'image/jpeg', arrayBuffer: vi.fn(), slice: vi.fn() } as unknown as File;
        await expect(svc.uploadPhoto(INSPECTION_ID, TENANT, 'item-1', big)).rejects.toMatchObject({ status: 400 });
        expect(big.arrayBuffer).not.toHaveBeenCalled();
        expect(big.slice).not.toHaveBeenCalled();
    });
});
