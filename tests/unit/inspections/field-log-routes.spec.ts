import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import fieldLogRoutes from '../../../server/api/field-log';

const event = (inspectionId: string, id: string) => ({
    id, inspectionId, occurredAt: 1_800_000_000_000, kind: 'action', name: 'rating',
});
const ID_A = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff';
const ID_B = '7f9619ff-8b86-4d01-b42d-00cf4fc964ff';

describe('field log routes', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    const app = (tenantId: string, sub: string) => new Hono()
        .use('*', async (c, next) => {
            const vars = c as unknown as { set: (k: string, v: unknown) => void };
            vars.set('tenantId', tenantId);
            vars.set('user', { sub, role: 'inspector' });
            vars.set('userRole', 'inspector');
            await next();
        })
        .route('/', fieldLogRoutes)
        .onError((e, c) => c.json({}, (e as unknown as { status: 403 }).status));
    const upload = (a: ReturnType<typeof app>, events: unknown[]) => a.request('/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
    }, { DB: {} });

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        await setupSchema(setup.sqlite);
        (db as unknown as { batch: unknown }).batch = (qs: Promise<unknown>[]) => Promise.all(qs);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        const at = new Date();
        await db.insert(schema.tenants).values([
            { id: 't1', slug: 'one', createdAt: at }, { id: 't2', slug: 'two', createdAt: at },
        ] as never);
        await db.insert(schema.users).values([
            { id: 'u1', tenantId: 't1', email: 'a@x.test', passwordHash: 'x', role: 'inspector', createdAt: at },
            { id: 'u2', tenantId: 't2', email: 'b@x.test', passwordHash: 'x', role: 'inspector', createdAt: at },
        ] as never);
        await db.insert(schema.inspections).values([
            { id: 'i1', tenantId: 't1', propertyAddress: 'a', date: '2026-01-01', createdAt: at },
            { id: 'i2', tenantId: 't2', propertyAddress: 'b', date: '2026-01-01', createdAt: at },
        ] as never);
    });

    it('refuses uploads until the user turns it on', async () => {
        expect((await upload(app('t1', 'u1'), [event('i1', ID_A)])).status).toBe(403);
        expect(await db.select().from(schema.fieldLogEvents)).toEqual([]);
    });

    it('stores own-tenant events once and ignores another tenant\'s inspection', async () => {
        const a = app('t1', 'u1');
        await a.request('/setting', {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}',
        }, { DB: {} });
        const body = [event('i1', ID_A), event('i2', ID_B)];
        expect((await upload(a, body)).status).toBe(204);
        expect((await upload(a, body)).status).toBe(204);
        const rows = await db.select().from(schema.fieldLogEvents);
        expect(rows.map((r) => [r.id, r.tenantId, r.userId])).toEqual([[ID_A, 't1', 'u1']]);
    });

    it('never shows one tenant the timeline of another', async () => {
        await db.insert(schema.fieldLogEvents).values({
            id: ID_A, tenantId: 't1', userId: 'u1', inspectionId: 'i1',
            occurredAt: new Date(), kind: 'action', name: 'rating',
        });
        const res = await app('t2', 'u2').request('/inspections/i1', {}, { DB: {} });
        expect(await res.json()).toEqual({ events: [], issues: [] });
    });
});
