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
import { and, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults } from '../db/schema';
import { AppError, ErrorCode } from '../errors';
import { logger } from '../logger';
import { resolvePrimaryReportId } from './reports';

/**
 * `data` is what drizzle's JSON column would return (the stored text parsed
 * once), except that a row whose text cannot be parsed keeps its raw text
 * instead of throwing inside the select. `readResultsData` then reports it as a
 * failure the caller can see.
 */
export type ReportResultsRow = Omit<typeof inspectionResults.$inferSelect, 'data'> & { data: unknown };

const rowColumns = { ...getTableColumns(inspectionResults), data: sql<unknown>`${inspectionResults.data}` };

function decodeOnce(row: ReportResultsRow): ReportResultsRow {
    if (typeof row.data !== 'string') return row;
    try { return { ...row, data: JSON.parse(row.data) as unknown }; } catch { return row; }
}

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
    requestEnv?: unknown,
): Promise<ResolvedReportResults> {
    const exactRow = async (id: string) => {
        const r = await db.select(rowColumns).from(inspectionResults)
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            eq(inspectionResults.inspectionId, inspectionId),
            eq(inspectionResults.reportId, id),
        ))
        .get();
        return r ? decodeOnce(r) : r;
    };
    if (reportId) {
        const exact = await exactRow(reportId);
        if (exact) return { reportId, row: exact, ambiguous: false };
    }
    const primaryId = await resolvePrimaryReportId(db, tenantId, inspectionId, requestEnv);
    const target = reportId ?? primaryId;
    if (target) {
        if (target !== reportId) {
            const exact = await exactRow(target);
            if (exact) return { reportId: target, row: exact, ambiguous: false };
        }
        // An ancillary report never reads a NULL row.
        if (target !== primaryId) return { reportId: target, row: null, ambiguous: false };
    }
    const nulls = await db.select(rowColumns).from(inspectionResults)
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            eq(inspectionResults.inspectionId, inspectionId),
            isNull(inspectionResults.reportId),
        ))
        .limit(2)
        .all();
    if (nulls.length > 1) return { reportId: target, row: null, ambiguous: true };
    return { reportId: target, row: nulls[0] ? decodeOnce(nulls[0]) : null, ambiguous: false };
}

/** The row alone, for readers that only need the document. Ambiguous reads as absent. */
export async function selectReportResultsRow(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
    reportId: string | null,
    requestEnv?: unknown,
): Promise<ReportResultsRow | null> {
    return (await resolveReportResults(db, tenantId, inspectionId, reportId, requestEnv)).row;
}

const AMBIGUOUS_RESULTS_REASON = 'ambiguous_results_rows';

/**
 * The row the legacy photo routes act on. They carry no report id, so the
 * target is the inspection's primary report; never a sibling's row. Two NULL
 * rows is a coded 409, not a guess. No row at all is returned as null: attach
 * creates one, the others answer 404. `requestEnv` shares the primary lookup
 * across one page render's calls (see resolvePrimaryReportId).
 */
export async function resolveLegacyPhotoTarget(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
    requestEnv?: unknown,
): Promise<{ reportId: string | null; row: ReportResultsRow | null }> {
    const { reportId, row, ambiguous } = await resolveReportResults(db, tenantId, inspectionId, null, requestEnv);
    if (ambiguous) {
        throw new AppError(409, ErrorCode.CONFLICT, 'This inspection holds more than one unassigned results row', { reason: AMBIGUOUS_RESULTS_REASON });
    }
    return { reportId, row };
}

type ResultsRead = { ok: true; data: Record<string, unknown> } | { ok: false };

const UNREADABLE_RESULTS_REASON = 'unreadable_results_row';

/**
 * `inspection_results.data` as an object. A missing value (NULL) and `{}` are
 * readable and empty. A JSON string, or one stringified up to three times, is
 * decoded. Malformed JSON, or a value that is not an object, is a FAILURE and is
 * never read as `{}`: an empty document and an undecodable one must not look alike.
 */
export function readResultsData(value: unknown): ResultsRead {
    let v = value;
    if (v === null || v === undefined) return { ok: true, data: {} };
    for (let i = 0; i < 3 && typeof v === 'string'; i++) {
        try { v = JSON.parse(v) as unknown; } catch { return { ok: false }; }
    }
    return v && typeof v === 'object' && !Array.isArray(v) ? { ok: true, data: v as Record<string, unknown> } : { ok: false };
}

/** For writers and route readers: the object, or a coded 409 that touches nothing. */
export function requireResultsData(value: unknown): Record<string, unknown> {
    const read = readResultsData(value);
    if (!read.ok) {
        throw new AppError(409, ErrorCode.CONFLICT, 'The stored results for this report could not be read', { reason: UNREADABLE_RESULTS_REASON });
    }
    return read.data;
}

/**
 * The publish gate: the target report's document as an object, or a coded 409
 * (ambiguous or unreadable) before the caller changes anything. No row at all is
 * an empty document, as it always was.
 */
export async function requireReportResultsForPublish(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
    reportId: string | null,
): Promise<{ row: ReportResultsRow | null; data: Record<string, unknown> }> {
    const { row, ambiguous } = await resolveReportResults(db, tenantId, inspectionId, reportId);
    if (ambiguous) {
        throw new AppError(409, ErrorCode.CONFLICT, 'This inspection holds more than one unassigned results row', { reason: AMBIGUOUS_RESULTS_REASON });
    }
    return { row, data: row ? requireResultsData(row.data) : {} };
}

/** For read-only paths: an unreadable row reads as no row, and the reason is logged (ids only). */
export function readResultsDataOrEmpty(value: unknown, ids: Record<string, unknown>): Record<string, unknown> {
    const read = readResultsData(value);
    if (read.ok) return read.data;
    logger.warn('results row could not be read, treated as empty for this read', ids);
    return {};
}

/**
 * The collab document's write to D1. The ONLY path that writes a report's
 * document content from the Durable Object.
 *   - Ambiguous (2+ unassigned rows, no exact row): write nothing; the DO keeps its state.
 *   - The primary report's unassigned row is CLAIMED first (report_id only, and only
 *     while still NULL), then the exact row is re-resolved: mine, or the winner's.
 *   - An insert happens only when resolution says there is no row at all.
 *   - A row whose stored data cannot be read is never overwritten.
 *   - Size decides nothing: a document that holds nothing is saved as {}.
 */
export async function persistReportResults(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
    reportId: string,
    values: { ydocState: Uint8Array; data: object },
): Promise<void> {
    let res = await resolveReportResults(db, tenantId, inspectionId, reportId);
    if (res.row && !readResultsData(res.row.data).ok) {
        // Checked before the claim so the row stays byte-identical, report_id included.
        logger.warn('collab persist: stored results could not be read, nothing written', { tenantId, inspectionId, reportId });
        return;
    }
    if (res.row && res.row.reportId == null) {
        await db.update(inspectionResults).set({ reportId })
            .where(and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.id, res.row.id), isNull(inspectionResults.reportId)));
        res = await resolveReportResults(db, tenantId, inspectionId, reportId);
    }
    if (res.ambiguous) {
        logger.warn('collab persist: more than one unassigned results row, nothing written', { tenantId, inspectionId, reportId });
        return;
    }
    if (!res.row) {
        await db.insert(inspectionResults).values({
            id: crypto.randomUUID(), tenantId, inspectionId, reportId, ydocState: values.ydocState, data: values.data, lastSyncedAt: new Date(),
        });
        return;
    }
    await db.update(inspectionResults)
        .set({ ydocState: values.ydocState, data: values.data, lastSyncedAt: new Date() })
        .where(and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.id, res.row.id)));
}
