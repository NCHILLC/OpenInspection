/**
 * Auto-sign on publish.
 *
 * When the inspection carries the flag AND the assigned inspector has a saved
 * signature, the signature is injected into `inspection_results.data` so the
 * published report renders signed without anyone doing a manual step.
 *
 * Behaviour-preserving extraction from the publish service — the body is a move,
 * not a rewrite.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults, inspections, users } from '../db/schema';
import { logger } from '../logger';
import { readResultsData, resolveLegacyPhotoTarget } from './report-results';

export async function applyAutoSignatureOnPublish(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<void> {
    const insp = await db.select().from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!insp?.autoSignOnPublish || !insp.inspectorId) return;

    const inspector = await db.select().from(users)
        .where(eq(users.id, insp.inspectorId)).get();
    if (!inspector?.defaultSignatureBase64) return;

    const { reportId, row: resultsRow } = await resolveLegacyPhotoTarget(db, tenantId, inspectionId);
    const read = readResultsData(resultsRow?.data);
    if (!read.ok) {
        // Publishing goes ahead; the signature is simply not added to a row that cannot be read.
        logger.warn('auto-sign: stored results could not be read, signature not added', { tenantId, inspectionId });
        return;
    }
    const data = read.data;
    data._inspector_signature = {
        signatureBase64: inspector.defaultSignatureBase64,
        signedAt:        Date.now(),
        userId:          inspector.id,
        auto:            true,
    };

    if (resultsRow) {
        await db.update(inspectionResults)
            .set({ data: data as object, lastSyncedAt: new Date() })
            .where(and(eq(inspectionResults.id, resultsRow.id), eq(inspectionResults.tenantId, tenantId)));
    } else {
        await db.insert(inspectionResults).values({
            id:           crypto.randomUUID(),
            tenantId,
            inspectionId,
            ...(reportId ? { reportId } : {}),
            data:         data as object,
            lastSyncedAt: new Date(),
        });
    }
}
