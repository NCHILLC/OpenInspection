/**
 * ISN reconcile: which listed orders get pulled, the cursor, and stale claims.
 * The pull itself is mocked; `isn-order-apply.spec.ts` covers what it does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
const pull = vi.fn(async (_d1: unknown, _t: string, _c: unknown, ref: string) => ref);
vi.mock('../../../server/services/isn/order-pull', () => ({ pullIsnOrder: pull }));
let secrets: Record<string, string> | null = null;
vi.mock('../../../server/lib/secrets-cache', () => ({ loadTenantSecrets: async () => secrets }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
const { reconcileIsnOrders, STALE_CLAIM_MS } = await import('../../../server/services/isn/order-reconcile');
const { isnConfig, isnCall } = await import('../../../server/services/isn/api-base');
const { isnOrderReconcileJob } = await import('../../../server/cron/jobs/integrations');

const TENANT = 't-isn';
const CFG = { domain: 'https://isn.test', companyKey: 'co', accessKey: 'isn-access-7Qm2xKd', secretKey: 'isn-secret-9Zp4vLc' };
const NOW = new Date('2026-10-25T12:00:00Z');
const D1 = {} as D1Database;

let db: BetterSQLite3Database<typeof schema>;
let listed: Record<string, unknown>[] = [];
const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ status: 'ok', orders: listed })));

const store = (isnOrderId: string, inspectionId: string | null, modified: string, fetchedAt = NOW) =>
    db.insert(schema.isnOrders).values({ id: `row-${isnOrderId}`, tenantId: TENANT, isnOrderId, inspectionId, payload: { id: isnOrderId, modified }, fetchedAt });
const pulled = () => pull.mock.calls.map((c) => c[3]);

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(db);
    vi.stubGlobal('fetch', fetchMock);
    listed = [];
});
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockClear(); pull.mockClear(); });

describe('reconcileIsnOrders', () => {
    it('lists today-forward orders from yesterday (UTC)', async () => {
        await reconcileIsnOrders(D1, TENANT, CFG, null, 5, NOW);
        const url = new URL(fetchMock.mock.calls[0]![0]);
        expect(url.pathname).toBe('/co/rest/orders');
        expect(url.searchParams.get('datetimeafter')).toBe('2026-10-24');
    });

    it('backfills an empty table in id order, one bounded batch per call', async () => {
        listed = [{ id: 'c', modified: '1' }, { id: 'a', modified: '1' }, { id: 'b', modified: '1' }];
        const first = await reconcileIsnOrders(D1, TENANT, CFG, null, 2, NOW);
        expect(pulled()).toEqual(['a', 'b']);
        expect(first).toEqual({ processed: 2, failed: 0, nextCursor: 'b' });

        pull.mockClear();
        const second = await reconcileIsnOrders(D1, TENANT, CFG, first.nextCursor, 2, NOW);
        expect(pulled()).toEqual(['c']);
        expect(second).toEqual({ processed: 1, failed: 0, nextCursor: null });
    });

    it('pulls only orders that changed in ISN or never became an inspection', async () => {
        await store('same', 'insp-1', '2026-10-24 09:00:00');
        await store('changed', 'insp-2', '2026-10-24 09:00:00');
        await store('failed-create', null, '2026-10-24 09:00:00');
        await store('cancelled-early', null, '2026-10-24 09:00:00');
        listed = [
            { id: 'same', modified: '2026-10-24 09:00:00' },
            { id: 'changed', modified: '2026-10-25 08:00:00' },
            { id: 'failed-create', modified: '2026-10-24 09:00:00' },
            { id: 'cancelled-early', modified: '2026-10-24 09:00:00', canceled: 'yes' },
            { id: 'new', modified: '2026-10-25 08:00:00' },
        ];
        await reconcileIsnOrders(D1, TENANT, CFG, null, 5, NOW);
        expect(pulled().sort()).toEqual(['changed', 'failed-create', 'new']);
    });

    it('an ISN error logged for a failed pull carries no configured credential', async () => {
        const SECRET = 'secret-Xw2-Rt8nBc4';
        const cfg = isnConfig({ ISN_DOMAIN: 'https://isn.test', ISN_COMPANY_KEY: 'co', ISN_ACCESS_KEY: 'a-key-1', ISN_SECRET_KEY: SECRET, ISN_WEBHOOK_SECRET: 'whsec-Hj5' })!;
        listed = [{ id: 'a', modified: '1' }];
        let calls = 0;
        fetchMock.mockImplementation(async () => (++calls === 1
            ? new Response(JSON.stringify({ status: 'ok', orders: listed }))
            : new Response(`${'x'.repeat(190)}${SECRET} and whsec-Hj5`, { status: 502 })));
        pull.mockImplementationOnce(async () => { await isnCall(cfg, 'GET', '/orders/a'); return 'a'; });
        const lines: string[] = [];
        const spies = (['info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(JSON.stringify(a)); }));
        try { await reconcileIsnOrders(D1, TENANT, cfg, null, 5, NOW); } finally { spies.forEach((s) => s.mockRestore()); }
        const logged = lines.join('\n');
        expect(logged).toContain('order pull failed');
        expect(logged).not.toMatch(/secret-|whsec-/);
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({ status: 'ok', orders: listed })));
    });

    it('keeps going past an order whose pull fails', async () => {
        listed = [{ id: 'a' }, { id: 'b' }];
        pull.mockRejectedValueOnce(new Error('ISN down'));
        const r = await reconcileIsnOrders(D1, TENANT, CFG, null, 5, NOW);
        expect(pulled()).toEqual(['a', 'b']);
        expect(r).toEqual({ processed: 1, failed: 1, nextCursor: null });
    });

    it('frees a stale pending claim and leaves a fresh one alone', async () => {
        await store('stale', 'pending:x', '1', new Date(NOW.getTime() - STALE_CLAIM_MS - 1000));
        await store('fresh', 'pending:y', '1', new Date(NOW.getTime() - 60_000));
        await reconcileIsnOrders(D1, TENANT, CFG, null, 5, NOW);
        const claim = async (id: string) => (await db.select().from(schema.isnOrders).where(eq(schema.isnOrders.isnOrderId, id)).get())?.inspectionId;
        expect(await claim('stale')).toBeNull();
        expect(await claim('fresh')).toBe('pending:y');
    });
});

describe('isnOrderReconcileJob', () => {
    const KEYS = { ISN_DOMAIN: 'https://isn.test', ISN_COMPANY_KEY: 'co', ISN_ACCESS_KEY: 'isn-access-7Qm2xKd', ISN_SECRET_KEY: 'isn-secret-9Zp4vLc' };
    const kv = new Map<string, string>();
    const env = () => ({
        DB: D1, JWT_SECRET: 'jwt',
        TENANT_CACHE: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
    }) as never;
    beforeEach(() => kv.clear());

    it('leaves ISN alone while the webhook secret is unset (keys alone serve the report-link sync)', async () => {
        secrets = { ...KEYS };
        await isnOrderReconcileJob.run(env(), null);
        expect(fetchMock).not.toHaveBeenCalled();
        // The pass still counts as done, so the probe stays quiet for the hour.
        expect(await isnOrderReconcileJob.probe(env())).toBe(0);
    });

    it('reconciles once the webhook secret is set', async () => {
        secrets = { ...KEYS, ISN_WEBHOOK_SECRET: 'whsec' };
        expect(await isnOrderReconcileJob.probe(env())).toBe(1);
        await isnOrderReconcileJob.run(env(), null);
        expect(new URL(fetchMock.mock.calls[0]![0]).pathname).toBe('/co/rest/orders');
    });
});
