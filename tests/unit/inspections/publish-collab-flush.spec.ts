/**
 * The publish path reads `inspection_results.data` out of D1 twice — once for
 * the readiness gate, once to freeze the signed `report_versions` snapshot — and
 * the collab Durable Object is the only writer of that column, on a 1 s
 * debounce. So the edit an inspector made a beat before clicking Publish was in
 * neither: the gate answered about a report it had not seen, and the snapshot
 * froze without it.
 *
 * `flushCollabDocForPublish` is the seam that closes that window. It is asserted
 * here rather than through the route because what can go wrong is all in the
 * addressing: the DO is keyed `${tenantId}:${reportId}` (NOT the inspection id),
 * and persist() skips its D1 write unless the identity headers arrive with the
 * request.
 */
import { describe, it, expect } from 'vitest';
import { flushCollabDocForPublish } from '../../../server/api/inspections/publish';

const TENANT = 'tenant-flush';
const INSPECTION = 'insp-flush';
const REPORT = 'report-flush';

function fakeNamespace(fetchImpl?: () => Promise<Response>) {
    const calls: Array<{ name: string; url: string; init: RequestInit | undefined }> = [];
    const ns = {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => ({
            fetch: (url: string, init?: RequestInit) => {
                calls.push({ name: id.name, url, init });
                return fetchImpl ? fetchImpl() : Promise.resolve(new Response(null, { status: 204 }));
            },
        }),
    };
    return { ns: ns as unknown as DurableObjectNamespace, calls };
}

describe('flushCollabDocForPublish', () => {
    it('POSTs /flush to the report-keyed document with the identity headers persist() needs', async () => {
        const { ns, calls } = fakeNamespace();
        await flushCollabDocForPublish(ns, TENANT, INSPECTION, REPORT);
        expect(calls).toHaveLength(1);
        // Keyed by REPORT, exactly as collab.ts addresses it. Keyed by the
        // inspection instead, this would flush an empty document.
        expect(calls[0]!.name).toBe(`${TENANT}:${REPORT}`);
        expect(calls[0]!.url).toContain('/flush');
        expect(calls[0]!.init?.method).toBe('POST');
        expect(calls[0]!.init?.headers).toMatchObject({
            'x-tenant-id': TENANT,
            'x-inspection-id': INSPECTION,
            'x-report-id': REPORT,
        });
    });

    it('does nothing when collab is not bound, or when the order has no report', async () => {
        const { ns, calls } = fakeNamespace();
        await flushCollabDocForPublish(undefined, TENANT, INSPECTION, REPORT);
        await flushCollabDocForPublish(ns, TENANT, INSPECTION, null);
        expect(calls).toHaveLength(0);
    });

    it('never fails the publish when the flush itself fails', async () => {
        const { ns } = fakeNamespace(() => Promise.reject(new Error('DO unreachable')));
        await expect(flushCollabDocForPublish(ns, TENANT, INSPECTION, REPORT)).resolves.toBeUndefined();
    });
});
