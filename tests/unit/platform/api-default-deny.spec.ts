/**
 * Default-deny on the API surface, through the REAL application and middleware
 * chain (no auth mocking): in-memory SQLite presented as D1, a real ES256
 * keyring, both deployment modes. Ported from upstream `c0b10264`, with the
 * harness inlined (upstream's lives in an email-harness helper this fork does
 * not carry) and the fork's own public surfaces added as positive controls.
 *
 *  1. a request with no session is refused on every protected /api/ path, in
 *     standalone as well as saas mode (the tenant resolving from configuration
 *     must not turn a missing session into access);
 *  2. an agent principal never receives staff context on staff endpoints.
 *
 * Every denial is paired with an allowed control.
 */
import { describe, it, expect, vi } from 'vitest';
import { drizzle as sqliteDrizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createTestDb, setupSchema } from '../db';
import { MockKV } from '../mocks';
import { toD1Binding } from '../helpers/d1-binding';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { HonoConfig } from '../../../server/types/hono';
import { isUnauthenticatedPath } from '../../../server/lib/auth/public-paths';
import { ANONYMOUS_API_ALLOW, AGENT_API_ALLOW, matchesRule } from '../../../server/lib/auth/api-access-policy';

type Mode = 'standalone' | 'saas';
type Actor = 'anon' | 'agent' | 'inspector' | 'owner';

const TENANT_ID = '11111111-0000-4000-8000-000000000001';
const OWNER_ID = '22222222-0000-4000-8000-000000000001';
const INSPECTOR_ID = '22222222-0000-4000-8000-000000000002';
const AGENT_ID = '22222222-0000-4000-8000-0000000000a1';
const THEIRS = '44444444-0000-4000-8000-000000000001';
const UUID = '00000000-0000-4000-8000-0000000000aa';

function toPem(label: string, der: ArrayBuffer): string {
    const lines = Buffer.from(der).toString('base64').match(/.{1,64}/g) ?? [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

let pems: { privatePem: string; publicPem: string } | null = null;
async function jwtKeyPems() {
    if (pems) return pems;
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    pems = {
        privatePem: toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
        publicPem: toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey)),
    };
    return pems;
}

async function seed(db: BetterSQLite3Database<typeof schema>) {
    const now = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db.insert(schema.tenants).values({
        id: TENANT_ID, slug: 'acme-deny', status: 'active', tier: 'free', maxUsers: 5, deploymentMode: 'shared', createdAt: now,
    });
    await db.insert(schema.users).values([
        { id: OWNER_ID, tenantId: TENANT_ID, email: 'owner@x.test', passwordHash: 'h', role: 'owner', name: 'Olive', createdAt: now },
        { id: INSPECTOR_ID, tenantId: TENANT_ID, email: 'ivan@x.test', passwordHash: 'h', role: 'inspector', name: 'Ivan', createdAt: now },
    ]);
    await db.insert(schema.tenantConfigs).values({ tenantId: TENANT_ID, companyName: 'Harbor Light', updatedAt: now });
    await seedRoleProfiles(asD1Db(db), TENANT_ID, now);
    await db.insert(schema.inspections).values({
        id: THEIRS, tenantId: TENANT_ID, inspectorId: OWNER_ID, propertyAddress: '99 Secret Lane', date: '2026-06-01',
        status: 'requested', paymentStatus: 'unpaid', price: 123456, agreementRequired: false, paymentRequired: false,
        reportStatus: 'in_progress', createdAt: now,
    } as never);
}

async function setup(mode: Mode) {
    const { sqlite } = createTestDb();
    await setupSchema(sqlite);
    const db = sqliteDrizzle(sqlite, { schema });
    const keys = await jwtKeyPems();
    const env = {
        APP_MODE: mode,
        ...(mode === 'standalone' ? { SINGLE_TENANT_ID: TENANT_ID } : {}),
        DB: toD1Binding(sqlite),
        TENANT_CACHE: new MockKV() as unknown as KVNamespace,
        JWT_SECRET: 'j'.repeat(32),
        KEY_ENCRYPTION_SECRET: 'k'.repeat(32),
        JWT_CURRENT_KID: 'v1',
        JWT_PRIVATE_KEY_V1: keys.privatePem,
        JWT_PUBLIC_KEY_V1: keys.publicPem,
        APP_BASE_URL: 'https://app.platform.test',
        // An empty bucket is all a probe needs; the delete cascade sweeps R2.
        PHOTOS: { list: async () => ({ objects: [], truncated: false }), delete: async () => undefined, get: async () => null },
    } as unknown as HonoConfig['Bindings'];
    // Nothing a probe triggers may reach the network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not stubbed', { status: 404 })));
    await seed(db);

    const keyring = await buildKeyring(env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const tokens: Record<Actor, string | null> = {
        anon: null,
        agent: await signJwt({ sub: AGENT_ID, role: 'agent', 'custom:userRole': 'agent', iat: now, exp: now + 3600 }, keyring),
        inspector: await signJwt({ sub: INSPECTOR_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'inspector', iat: now, exp: now + 3600 }, keyring),
        owner: await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring),
    };
    const call = async (actor: Actor, method: string, path: string, body?: unknown) => {
        const headers: Record<string, string> = {};
        const t = tokens[actor];
        if (t) headers.authorization = `Bearer ${t}`;
        const init: RequestInit = { method, headers };
        if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
        const exec = makeExecutionContext({ label: 'deny' });
        const res = await app.request(path, init, env, exec.ctx);
        await exec.settle();
        return res;
    };
    const close = () => { vi.unstubAllGlobals(); sqlite.close(); };
    return { call, close };
}

const fill = (p: string) => p.replace(/:([A-Za-z]+)(\{[^}]*\})?/g, (_m, n: string) => (/^id$|inspectionId/i.test(n) ? THEIRS : UUID));

function mountedApiRoutes(): Array<{ method: string; path: string }> {
    const routes = (app as unknown as { routes: Array<{ method: string; path: string }> }).routes;
    const seen = new Set<string>();
    const out: Array<{ method: string; path: string }> = [];
    for (const r of routes) {
        if (r.method === 'ALL' || r.path.includes('*') || !r.path.startsWith('/api/')) continue;
        const k = `${r.method} ${r.path}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
    }
    return out;
}

describe('allow-lists are reviewed', () => {
    it('every entry carries a reason and matches a real mounted route', () => {
        const paths = mountedApiRoutes().map((r) => fill(r.path));
        for (const rule of [...ANONYMOUS_API_ALLOW, ...AGENT_API_ALLOW]) {
            expect(rule.why.length, String(rule.match)).toBeGreaterThan(10);
            expect(paths.some((p) => matchesRule([rule], p)), `stale allow-list entry ${String(rule.match)}`).toBe(true);
        }
    });
});

describe.each(['standalone', 'saas'] as const)('anonymous matrix (%s)', (mode) => {
    it('every mounted /api/ route is public-by-design (with a reason) or answers 401 without a session', { timeout: 180_000 }, async () => {
        const { call, close } = await setup(mode);
        try {
            const open: string[] = [];
            let denied = 0;
            let allowed = 0;
            for (const r of mountedApiRoutes()) {
                const path = fill(r.path);
                if (isUnauthenticatedPath(path) || matchesRule(ANONYMOUS_API_ALLOW, path)) { allowed += 1; continue; }
                if (/\/ws$|presence|collab/.test(path)) continue;
                const res = await call('anon', r.method, path, r.method === 'GET' ? undefined : {});
                if (res.status === 401) denied += 1;
                else open.push(`${res.status} ${r.method} ${r.path}`);
            }
            // Both numbers are printed: a vacuous matrix (0 denied) must not read as green.
            expect(denied, `denied=${denied} allowed=${allowed}`).toBeGreaterThan(300);
            expect(allowed).toBeGreaterThan(30);
            expect(open, open.join('\n')).toEqual([]);
        } finally { close(); }
    });
});

describe('standalone: no session means no access', () => {
    it.each([
        ['GET', `/api/inspections/${THEIRS}`],
        ['GET', '/api/inspections'],
        ['GET', '/api/analytics/growth'],
        ['GET', '/api/usage/summary'],
        ['GET', '/api/integrations/status'],
    ])('anonymous %s %s is refused and leaks nothing; the owner is not refused', async (method, path) => {
        const { call, close } = await setup('standalone');
        try {
            const anon = await call('anon', method, path);
            expect(anon.status).toBe(401);
            expect(await anon.text()).not.toContain('99 Secret Lane');
            expect((await call('owner', method, path)).status).not.toBe(401);
        } finally { close(); }
    });

    it('public surfaces still answer anonymously (positive controls)', async () => {
        const { call, close } = await setup('standalone');
        try {
            expect((await call('anon', 'GET', '/api/auth/setup-status')).status).toBe(200);
            expect((await call('anon', 'GET', '/status')).status).toBe(200);
            expect((await call('anon', 'GET', '/api/public/services')).status).toBe(200);
            // Fork-only: the ISN webhook authenticates by its own ?key= secret, the
            // client portal by its token. Either may refuse the probe, but the
            // refusal must be the route's own, never a missing session.
            const isn = await call('anon', 'POST', '/webhooks/isn', {});
            expect(await isn.text()).toContain('Invalid signature');
            expect((await call('anon', 'GET', `/api/portal/${UUID}`)).status).not.toBe(401);
            expect((await call('anon', 'POST', '/api/auth/login', {})).status).not.toBe(401);
        } finally { close(); }
    });
});

describe.each(['standalone', 'saas'] as const)('agent principal on staff endpoints (%s)', (mode) => {
    it.each([
        `/api/inspections/${THEIRS}`,
        `/api/inspections/${THEIRS}/results`,
        '/api/inspections',
        '/api/tenant/inspection-prefs',
    ])('agent GET %s is refused', async (path) => {
        const { call, close } = await setup(mode);
        try {
            const res = await call('agent', 'GET', path);
            expect([401, 403]).toContain(res.status);
            expect(await res.text()).not.toContain('99 Secret Lane');
        } finally { close(); }
    });

    it('agent session endpoints still work (positive controls)', async () => {
        const { call, close } = await setup(mode);
        try {
            expect((await call('agent', 'GET', '/api/session/context')).status).toBe(200);
            expect((await call('agent', 'GET', '/api/auth/me')).status).not.toBe(403);
            expect((await call('agent', 'POST', '/api/auth/logout')).status).toBe(200);
            expect((await call('agent', 'POST', '/api/auth/2fa/setup', {})).status).toBe(403);
        } finally { close(); }
    });
});
