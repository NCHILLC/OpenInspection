/** Called inside the primary document's concurrency gate, never directly by an HTTP handler. */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionMediaPool, inspections, inspectionResults, isnOrders, reports, reportVersions } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { REPORT_STATUS } from '../../lib/status/report-status';
import { primaryIsUntouched } from '../../lib/inspection/report-generation';
import { selectReportResultsRow } from '../../lib/inspection/report-results';
import { mappedIsnTemplate } from './template-mapping';
import { untouchedIsnTemplateGuard } from './template-application-guard';

export async function applyIsnTemplate(db: DrizzleD1Database, tenantId: string, inspectionId: string, reportId: string, documentOpened: boolean) {
    const inspection = await db.select().from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), eq(inspections.id, inspectionId))).get();
    const link = await db.select({ payload: isnOrders.payload }).from(isnOrders)
        .where(and(eq(isnOrders.tenantId, tenantId), eq(isnOrders.inspectionId, inspectionId))).get();
    if (!inspection || !link) throw Errors.NotFound('This inspection has no linked ISN order');
    const mapped = await mappedIsnTemplate(db, tenantId, link.payload);
    if (!mapped) throw Errors.Conflict('This ISN inspection type has no primary template mapping. Ask an owner or manager to configure it in Settings → Advanced.');
    const reportRows = await db.select().from(reports)
        .where(and(eq(reports.tenantId, tenantId), eq(reports.inspectionId, inspectionId))).all();
    const primary = reportRows.find((row) => row.id === reportId && row.kind === 'primary');
    if (!primary || reportRows.length !== 1) throw Errors.Conflict('Template mapping can only be applied to an inspection with one primary report.');
    // A retry after success is harmless, including a retry after opening the editor.
    if (inspection.templateId === mapped.id && primary.templateId === mapped.id && inspection.templateSnapshot != null) return { changed: false };
    const versions = await db.select({ id: reportVersions.id }).from(reportVersions)
        .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId))).limit(1).all();
    if (inspection.reportStatus !== REPORT_STATUS.IN_PROGRESS || primary.status !== REPORT_STATUS.IN_PROGRESS || primary.publishedAt || versions.length) {
        throw Errors.Conflict('A report has been submitted or published. Its template cannot be replaced.');
    }
    const loosePhoto = await db.select({ id: inspectionMediaPool.id }).from(inspectionMediaPool)
        .where(and(eq(inspectionMediaPool.tenantId, tenantId), eq(inspectionMediaPool.inspectionId, inspectionId))).get();
    if (documentOpened || loosePhoto || primary.inspectorNarrative?.trim() || !(await primaryIsUntouched(db, tenantId, inspectionId, reportId))) {
        throw Errors.Conflict('The report has been opened or contains writing, photos, or Repair Items. Its template cannot be replaced.');
    }
    const results = await selectReportResultsRow(db, tenantId, inspectionId, reportId);
    if (!results) throw Errors.Conflict('The primary report’s result state is unavailable. No template was changed.');
    // D1 batch is atomic: readers see both template pointers and the new
    // snapshot together. Results identity stays stable; the editor seeds the
    // new snapshot on its first connection rather than loading old Yjs state.
    const guard = untouchedIsnTemplateGuard(tenantId, inspectionId, reportId, mapped.id, results.id);
    const [changed] = await db.batch([
        db.update(inspections).set({ templateId: mapped.id, templateSnapshot: mapped.schema, templateSnapshotVersion: mapped.version })
            .where(and(eq(inspections.tenantId, tenantId), eq(inspections.id, inspectionId), guard)).returning({ id: inspections.id }),
        db.update(reports).set({ templateId: mapped.id })
            .where(and(eq(reports.tenantId, tenantId), eq(reports.id, reportId), eq(reports.inspectionId, inspectionId), guard)).returning({ id: reports.id }),
        db.update(inspectionResults).set({ reportId, data: {}, ydocState: null, ratingSystemId: null, ratingSystemSnapshot: null })
            .where(and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.id, results.id), eq(inspectionResults.inspectionId, inspectionId), guard)).returning({ id: inspectionResults.id }),
    ]);
    if (changed.length !== 1) throw Errors.Conflict('The report or mapping changed while it was being checked. No template was changed. Try again.');
    return { changed: true };
}
