/**
 * The `inspection_results` row for ONE report.
 *
 * `report_id` is unique, so an inspection that delivers a standard and a radon
 * report holds two rows. A read keyed by `(tenant, inspection)` alone returns
 * whichever the driver hands over first, and a write keyed that way overwrites
 * the wrong report. Everything that needs one report's document goes through
 * here instead.
 *
 * `report_id` is nullable in the schema, so a row can predate reports. That row
 * counts only when it is the SOLE row of the inspection: then there is no other
 * report it could be mistaken for. With more than one row and no match, the
 * answer is `null` rather than a guess.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults } from '../db/schema';
import { Errors } from '../errors';
import { resolvePrimaryReportId } from './reports';

export interface ReportResultsRow {
    id: string;
    reportId: string | null;
    data: unknown;
}

const COLUMNS = {
    id: inspectionResults.id,
    reportId: inspectionResults.reportId,
    data: inspectionResults.data,
};

export async function selectReportResultsRow(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
    reportId: string | null,
): Promise<ReportResultsRow | null> {
    if (reportId) {
        const scoped = await db.select(COLUMNS).from(inspectionResults)
            .where(and(
                eq(inspectionResults.tenantId, tenantId),
                eq(inspectionResults.inspectionId, inspectionId),
                eq(inspectionResults.reportId, reportId),
            ))
            .get();
        if (scoped) return scoped;
    }
    const rows = await db.select(COLUMNS).from(inspectionResults)
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            eq(inspectionResults.inspectionId, inspectionId),
        ))
        .limit(2)
        .all();
    return rows.length === 1 && rows[0].reportId == null ? rows[0] : null;
}

/**
 * The row the legacy photo routes act on. They carry no report id, so the
 * target is the inspection's primary report; never a sibling's row. No primary
 * report and no row that can be told apart is a coded 4xx, not a guess.
 */
export async function resolveLegacyPhotoTarget(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
): Promise<{ reportId: string | null; row: ReportResultsRow | null }> {
    const reportId = await resolvePrimaryReportId(db, tenantId, inspectionId);
    const row = await selectReportResultsRow(db, tenantId, inspectionId, reportId);
    if (!row && !reportId) throw Errors.Conflict('This inspection has no primary report to attach photos to');
    return { reportId, row };
}
