/**
 * The `inspection_results` row for ONE report.
 *
 * `report_id` is unique, so an inspection that delivers a standard and a radon
 * report holds two rows. A read keyed by `(tenant, inspection)` alone returns
 * whichever the driver hands over first, and a write keyed that way overwrites
 * the wrong report. Everything that needs one report's document goes through
 * `resolveReportResults`, so hydrate, persist, snapshot, the photo routes and
 * render cannot disagree about which row is whose.
 *
 * THE RULE. `report_id` is nullable, so a row can predate reports. A NULL row
 * belongs to the inspection's PRIMARY report, whether or not that report exists
 * yet. An ancillary report never reads a NULL row. Resolving for report R:
 *   - the exact row for R; else
 *   - if R is the primary report, the NULL row; else
 *   - no row.
 * With no report named, R is the primary report; with no primary report either,
 * the NULL row is the only candidate. More than one NULL row is ambiguous and
 * is reported as such rather than resolved by picking one.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults } from '../db/schema';
import { AppError, ErrorCode } from '../errors';
import { logger } from '../logger';
import { resolvePrimaryReportId } from './reports';

export type ReportResultsRow = typeof inspectionResults.$inferSelect;

interface ResolvedReportResults {
    /** The report the row belongs to (or will belong to): the named one, else the primary, else null. */
    reportId: string | null;
    row: ReportResultsRow | null;
    /** More than one NULL row and no exact row: nothing may be picked. */
    ambiguous: boolean;
}

async function resolveReportResults(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
    reportId: string | null,
): Promise<ResolvedReportResults> {
    const exactRow = (id: string) => db.select().from(inspectionResults)
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            eq(inspectionResults.inspectionId, inspectionId),
            eq(inspectionResults.reportId, id),
        ))
        .get();
    if (reportId) {
        const exact = await exactRow(reportId);
        if (exact) return { reportId, row: exact, ambiguous: false };
    }
    const primaryId = await resolvePrimaryReportId(db, tenantId, inspectionId);
    const target = reportId ?? primaryId;
    if (target) {
        if (target !== reportId) {
            const exact = await exactRow(target);
            if (exact) return { reportId: target, row: exact, ambiguous: false };
        }
        // An ancillary report never reads a NULL row.
        if (target !== primaryId) return { reportId: target, row: null, ambiguous: false };
    }
    const nulls = await db.select().from(inspectionResults)
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            eq(inspectionResults.inspectionId, inspectionId),
            isNull(inspectionResults.reportId),
        ))
        .limit(2)
        .all();
    if (nulls.length > 1) return { reportId: target, row: null, ambiguous: true };
    return { reportId: target, row: nulls[0] ?? null, ambiguous: false };
}

/** The row alone, for readers that only need the document. Ambiguous reads as absent. */
export async function selectReportResultsRow(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
    reportId: string | null,
): Promise<ReportResultsRow | null> {
    return (await resolveReportResults(db, tenantId, inspectionId, reportId)).row;
}

const AMBIGUOUS_RESULTS_REASON = 'ambiguous_results_rows';

/**
 * The row the legacy photo routes act on. They carry no report id, so the
 * target is the inspection's primary report; never a sibling's row. Two NULL
 * rows is a coded 409, not a guess. No row at all is returned as null: attach
 * creates one, the others answer 404.
 */
export async function resolveLegacyPhotoTarget(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
): Promise<{ reportId: string | null; row: ReportResultsRow | null }> {
    const { reportId, row, ambiguous } = await resolveReportResults(db, tenantId, inspectionId, null);
    if (ambiguous) {
        throw new AppError(409, ErrorCode.CONFLICT, 'This inspection holds more than one unassigned results row', { reason: AMBIGUOUS_RESULTS_REASON });
    }
    return { reportId, row };
}

/**
 * First persist of the PRIMARY report's document with no row of its own: take
 * over the unassigned row in one tenant-filtered UPDATE rather than inserting a
 * second row beside it. False means nothing was adopted (an ancillary report, no
 * unassigned row, or more than one) and the caller inserts.
 */
export async function adoptUnassignedResultsRow(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
    reportId: string,
    values: { ydocState: Uint8Array; data: object },
): Promise<boolean> {
    const { row, ambiguous } = await resolveReportResults(db, tenantId, inspectionId, reportId);
    if (ambiguous) logger.warn('collab persist: more than one unassigned results row, inserting a report row', { inspectionId });
    if (!row || row.reportId != null) return false;
    const res = await db.update(inspectionResults)
        .set({ reportId, ydocState: values.ydocState, data: values.data, lastSyncedAt: new Date() })
        .where(and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.id, row.id), isNull(inspectionResults.reportId)));
    return (res.meta?.changes ?? 0) > 0;
}
