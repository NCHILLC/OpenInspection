/**
 * `removeMember` must refuse to remove the sole owner, same `otherOwners`
 * guard `updateMember` already applies before a role change. Without it, a
 * manager (the route allows manager|owner) could remove the last owner and
 * leave the workspace with nobody able to administer it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { TeamService } from '../../../server/services/team.service';
import { MockKV } from '../mocks';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000e1';
const OWNER = '11111111-1111-1111-1111-1111111111e1';
const OWNER2 = '33333333-3333-3333-3333-3333333333e1';
const MANAGER = '22222222-2222-2222-2222-2222222222e1';

describe('TeamService.removeMember — last-owner guard', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let kv: MockKV;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        kv = new MockKV();

        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'lastowner', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: OWNER, tenantId: TENANT, email: 'owner@lastowner.test',
            passwordHash: 'x', role: 'owner', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: MANAGER, tenantId: TENANT, email: 'mgr@lastowner.test',
            passwordHash: 'x', role: 'manager', createdAt: new Date(),
        });
    });

    it('refuses to remove the sole owner and leaves the row active', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, undefined, kv as any);

        await expect(team.removeMember(TENANT, OWNER, MANAGER))
            .rejects.toThrow('Cannot remove the last owner');

        const row = await testDb.select().from(schema.users).where(eq(schema.users.id, OWNER)).get();
        expect(row?.deletedAt).toBeNull();
    });

    it('still succeeds removing an owner when another owner remains', async () => {
        await testDb.insert(schema.users).values({
            id: OWNER2, tenantId: TENANT, email: 'owner2@lastowner.test',
            passwordHash: 'x', role: 'owner', createdAt: new Date(),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, undefined, kv as any);

        await expect(team.removeMember(TENANT, OWNER, MANAGER)).resolves.toBeDefined();

        const row = await testDb.select().from(schema.users).where(eq(schema.users.id, OWNER)).get();
        expect(row?.deletedAt).not.toBeNull();
    });
});
