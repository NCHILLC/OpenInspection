import { and, eq, or, isNull, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { reportVersions } from './db/schema';
import { resolvePrimaryReportId } from './inspection/reports';
import type { Snapshot } from './version-diff';

/**
 * Reading what a published report FROZE.
 *
 * Its own module rather than a private method on the report service, because it
 * belongs to the VERSION track, not the report-assembly track — and the service
 * it would otherwise sit in is already 900 lines of assembly.
 */

/**
 * The snapshot for one published version, or null.
 *
 * TOLERANT IN ONE DIRECTION ONLY. A missing or unparseable row falls back to
 * live resolution, because a client holding a per-version link must still get
 * their report — a stricter failure would turn a storage problem into a
 * customer-facing outage on a document they already own. What it must never do
 * is silently serve a DIFFERENT version, so the lookup is exact on
 * (tenant, inspection, version) and returns null rather than the nearest match.
 */
export async function loadPinnedSnapshot(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
    versionNumber: number,
    /**
     * WHICH deliverable's chain the version number names. Omitted means the
     * primary report -- the same default `getReportData` renders -- because
     * version numbers restart at 1 per report, so an inspection-wide lookup can
     * serve the sibling deliverable's frozen row under the same number. A row
     * with no reportId predates the reports entity and belongs to the primary.
     */
    reportId?: string,
): Promise<Snapshot | null> {
    try {
        // A legacy row carries no reportId and belongs to the PRIMARY; folding it
        // into an ancillary's scope would serve the primary's frozen snapshot
        // under the ancillary's version number.
        const primary = await resolvePrimaryReportId(db, tenantId, inspectionId);
        const target = reportId ?? primary;
        const row = await db.select({ snapshotJson: reportVersions.snapshotJson })
            .from(reportVersions)
            .where(and(
                eq(reportVersions.tenantId, tenantId),
                eq(reportVersions.inspectionId, inspectionId),
                eq(reportVersions.versionNumber, versionNumber),
                target
                    ? (target === primary
                        ? or(eq(reportVersions.reportId, target), isNull(reportVersions.reportId))
                        : eq(reportVersions.reportId, target))
                    : undefined,
            )).get();
        if (!row?.snapshotJson) return null;
        return JSON.parse(row.snapshotJson) as Snapshot;
    } catch {
        return null;
    }
}

/** Snapshot fields that name a stored file. */
const FILE_KEY_FIELDS = new Set(['key', 'annotatedKey', 'croppedKey', 'posterKey', 'streamUid', 'mediaId']);

/** Most versions of one inspection read at once; an inspection has a handful. */
const MAX_VERSIONS_SCANNED = 200;

/** Every stored-file key a results document names (original, annotated, cropped, video, poster), added to `into`. */
export function collectFileKeys(node: unknown, into: Set<string>): void {
    if (Array.isArray(node)) { for (const item of node) collectFileKeys(item, into); return; }
    if (node === null || typeof node !== 'object') return;
    for (const [name, value] of Object.entries(node)) {
        if (typeof value === 'string') { if (FILE_KEY_FIELDS.has(name) && value) into.add(value); }
        else collectFileKeys(value, into);
    }
}

/**
 * Every stored file the published versions of an inspection refer to: photos (original, annotated, cropped), videos (stored key,
 * poster, stream id) and the cover. A frozen report shows these exactly as published, so they must outlive any later edit of the
 * working copy. ALL versions, not only the latest: an earlier version stays verifiable. Used by the orphan sweep, which must not
 * reap them.
 *
 * Throws when a version's data cannot be read: the files of that version are unknown, so the caller must not free anything on the
 * strength of an incomplete list.
 */
export async function loadFrozenFileKeys(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inspectionId: string,
): Promise<Set<string>> {
    const rows = await db.select({
        data: sql<string | null>`json_extract(${reportVersions.snapshotJson}, '$.data')`,
        coverImageKey: sql<string | null>`json_extract(${reportVersions.snapshotJson}, '$.inspection.coverImageKey')`,
        coverPhotoId: sql<string | null>`json_extract(${reportVersions.snapshotJson}, '$.inspection.coverPhotoId')`,
    }).from(reportVersions)
        .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId)))
        .limit(MAX_VERSIONS_SCANNED).all();
    const keys = new Set<string>();
    for (const row of rows) {
        if (row.coverImageKey) keys.add(row.coverImageKey);
        if (row.coverPhotoId) keys.add(row.coverPhotoId);
        if (typeof row.data !== 'string') continue;
        try { collectFileKeys(JSON.parse(row.data), keys); }
        catch (err) {
            throw new Error(`snapshot data of inspection ${inspectionId} is unreadable`, { cause: err });
        }
    }
    return keys;
}
