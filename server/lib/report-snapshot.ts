import { and, eq, or, isNull } from 'drizzle-orm';
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
        const target = reportId ?? await resolvePrimaryReportId(db, tenantId, inspectionId);
        const row = await db.select({ snapshotJson: reportVersions.snapshotJson })
            .from(reportVersions)
            .where(and(
                eq(reportVersions.tenantId, tenantId),
                eq(reportVersions.inspectionId, inspectionId),
                eq(reportVersions.versionNumber, versionNumber),
                target
                    ? or(eq(reportVersions.reportId, target), isNull(reportVersions.reportId))
                    : undefined,
            )).get();
        if (!row?.snapshotJson) return null;
        return JSON.parse(row.snapshotJson) as Snapshot;
    } catch {
        return null;
    }
}
