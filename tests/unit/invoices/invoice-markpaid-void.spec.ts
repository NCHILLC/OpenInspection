/**
 * markPaid must refuse a voided invoice, same guard `recordOfflinePayment`
 * already has (invoice-payments.service.ts). Without it, staff could mark a
 * voided invoice paid and the route flips `inspections.paymentStatus` to
 * 'paid', unlocking the client's report gate for an invoice that no longer
 * represents money owed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { markPaid } from '../../../server/services/invoice-payments.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000006';
const INSP = 'i-markpaid-void-1';

describe('markPaid — refuses a voided invoice', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'markpaidvoidco', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '4 Void Ct', date: '2026-06-22',
            status: 'completed', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: true, createdAt: new Date(),
        });
    });

    it('throws Conflict and records no payment', async () => {
        await testDb.insert(schema.invoices).values({
            id: 'inv-void-markpaid', tenantId: TENANT, inspectionId: INSP,
            amountCents: 30000,
            lineItems: [{ description: 'Inspection', amountCents: 30000 }],
            voidedAt: new Date('2026-06-02'),
            createdAt: new Date(),
        } as never);

        // better-sqlite3 stands in for D1 here, as it does across tests/unit.
        await expect(markPaid(testDb as unknown as Parameters<typeof markPaid>[0], 'inv-void-markpaid', TENANT))
            .rejects.toThrow('This invoice is void; it cannot take a payment.');

        const payments = await testDb.select().from(schema.orderPayments)
            .where(eq(schema.orderPayments.invoiceId, 'inv-void-markpaid')).all();
        expect(payments).toHaveLength(0);

        const row = await testDb.select().from(schema.invoices)
            .where(eq(schema.invoices.id, 'inv-void-markpaid')).get();
        expect(row?.paidAt).toBeNull();
    });
});
