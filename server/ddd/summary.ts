/**
 * What `DddFeed` returns (fork-only; see docs/develop/fork-log.md): the residential Summary of an
 * inspection's latest PUBLISHED report version, and one Summary finding's own photos as JPEG.
 * The contract is SRS.md section 4 in NCHILLC/data-driven-direction. Nothing here returns a
 * client's name or email.
 *
 * A report never published yields its address and ISN reference with no findings: the draft is
 * the inspector's work in progress, and nobody outside NCHI has been sent it.
 */
import { eq } from 'drizzle-orm';
import { inspections } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { sniffImageDimensions } from '../lib/media/image-dimensions';
import type { ImagesBinding } from '../lib/media/strip-exif';
import { createDrizzle } from '../lib/route-helpers';
import { InspectionService } from '../services/inspection.service';
import { ReportVersionService } from '../services/report-version.service';

/** The bindings the feed reads: the same set the Word-export consumer builds its services from. */
export interface DddFeedEnv {
    DB: D1Database;
    PHOTOS: R2Bucket;
    TENANT_CACHE?: KVNamespace;
    IMAGES?: ImagesBinding;
    KEY_ENCRYPTION_SECRET?: string;
    JWT_SECRET: string; // required on every deployment (CLAUDE.md); the fallback key for report versions
}

export type DddSeverity = 'minor' | 'moderate' | 'safety';

export interface DddFinding {
    findingKey: string; // sectionId:itemId:defectId, unique per Summary entry
    defectKey: string; // section::item::title, the canned-comment library's Section, Item and Comment Name
    section: string;
    item: string;
    title: string;
    text: string; // the finding's comment as the report shows it
    severity: DddSeverity;
    location: string | null;
    trade: string | null;
}

export interface DddSummary {
    inspectionId: string;
    isnOrderRef: string | null; // the inspection's Reference Number, where NCHI keeps the ISN order
    address: string;
    publishedAt: number | null; // epoch ms of the latest publish; the findings are that version's
    findings: DddFinding[];
}

export interface DddPhoto {
    mediaType: 'image/jpeg';
    data: ArrayBuffer;
}

const MAX_PHOTOS = 6;
const LONG_SIDE_PX = 1568;

/**
 * A defect category's display name, as one of the three severities the review shows.
 * ponytail: matched by name; NCHI's own category names are confirmed on a real report before
 * launch (SRS Phase 2). A category nobody recognises reads as minor.
 */
export function severityOf(category: string | null | undefined): DddSeverity {
    const name = (category ?? '').toLowerCase();
    if (/safety|major/.test(name)) return 'safety';
    if (/moderate|recommend/.test(name)) return 'moderate';
    return 'minor';
}

/** The subset of `getReportData`'s sections this module reads. */
interface ReportSection {
    id: string;
    title: string;
    items: Array<{
        id: string;
        label: string;
        resolvedTabs?: {
            defects?: Array<{
                id: string;
                title: string;
                included: boolean;
                drivesSummary?: boolean;
                effectiveComment: string;
                effectiveCategory?: string;
                effectiveLocation?: string | null;
                effectiveTrade?: string | null;
                defectPhotos?: Array<{ key: string; url: string }>;
            }>;
        };
    }>;
}

/**
 * The Summary's findings in report order, by the rule the report's own Summary uses
 * (`itemDrivesSummary` in app/lib/report-helpers.ts): an included finding whose category drives
 * the Summary. `photoKeys` are its own photos; a video resolves with no URL and is left out.
 */
export function summaryFindings(sections: ReportSection[]): Array<DddFinding & { photoKeys: string[] }> {
    const out: Array<DddFinding & { photoKeys: string[] }> = [];
    for (const section of sections) {
        for (const item of section.items) {
            for (const d of item.resolvedTabs?.defects ?? []) {
                if (!d.included || d.drivesSummary === false) continue;
                out.push({
                    findingKey: `${section.id}:${item.id}:${d.id}`,
                    defectKey: `${section.title}::${item.label}::${d.title}`,
                    section: section.title,
                    item: item.label,
                    title: d.title,
                    text: d.effectiveComment,
                    severity: severityOf(d.effectiveCategory),
                    location: d.effectiveLocation ?? null,
                    trade: d.effectiveTrade ?? null,
                    photoKeys: (d.defectPhotos ?? []).filter((p) => p.url).map((p) => p.key),
                });
            }
        }
    }
    return out;
}

async function loadReport(env: DddFeedEnv, inspectionId: string) {
    // Keyed by the inspection id alone, as the render-token path in public-report.ts is: the
    // caller holds a service binding, not a tenant session, and the tenant comes from the row.
    const row = await createDrizzle(env.DB)
        .select({ tenantId: inspections.tenantId, address: inspections.propertyAddress, referenceNumber: inspections.referenceNumber })
        .from(inspections).where(eq(inspections.id, inspectionId)).get();
    if (!row) return null;
    const secret = env.KEY_ENCRYPTION_SECRET || env.JWT_SECRET;
    const latest = await new ReportVersionService(env.DB, secret).getLatestPublished(row.tenantId, inspectionId);
    if (!latest) return { row, latest: null, data: null };
    const data = await new InspectionService(env.DB, env.PHOTOS, undefined, env.TENANT_CACHE, env.IMAGES, undefined, secret)
        .getReportData(inspectionId, row.tenantId, (key) => key, undefined, latest.versionNumber);
    return { row, latest, data };
}

export async function readSummary(env: DddFeedEnv, inspectionId: string): Promise<DddSummary | null> {
    const report = await loadReport(env, inspectionId);
    if (!report) return null;
    const { row, latest, data } = report;
    if (data?.reportTier) return null; // a commercial report has no Summary
    return {
        inspectionId,
        isnOrderRef: row.referenceNumber?.trim() || null,
        address: row.address,
        publishedAt: latest?.publishedAt ? latest.publishedAt * 1000 : null, // the service answers in seconds
        findings: data ? summaryFindings(data.sections).map(({ photoKeys: _, ...finding }) => finding) : [],
    };
}

/** One photo as JPEG no larger than LONG_SIDE_PX; null when it is gone or can't be made a JPEG. */
async function jpeg(env: DddFeedEnv, key: string): Promise<ArrayBuffer | null> {
    const obj = await env.PHOTOS.get(key);
    if (!obj) return null;
    const original = await obj.arrayBuffer();
    if (env.IMAGES) {
        try {
            const out = await env.IMAGES.input(original)
                .transform({ width: LONG_SIDE_PX, height: LONG_SIDE_PX, fit: 'scale-down' })
                .output({ format: 'image/jpeg' });
            return await out.response().arrayBuffer();
        } catch (err) {
            logger.warn('[ddd-feed] photo resize failed; sending the original if it is a JPEG', { key, error: String(err) });
        }
    }
    return sniffImageDimensions(new Uint8Array(original))?.type === 'jpg' ? original : null;
}

export async function readFindingPhotos(env: DddFeedEnv, inspectionId: string, findingKey: string): Promise<DddPhoto[]> {
    // ponytail: reads the whole report once per finding; cache it per inspection if the CCR
    // build ever shows up as slow.
    const report = await loadReport(env, inspectionId);
    if (!report?.data || report.data.reportTier) return [];
    const finding = summaryFindings(report.data.sections).find((f) => f.findingKey === findingKey);
    const photos: DddPhoto[] = [];
    for (const key of finding?.photoKeys.slice(0, MAX_PHOTOS) ?? []) {
        // The same ownership rule as the public photo route: this tenant, this inspection.
        if (!key.startsWith(`${report.row.tenantId}/inspections/${inspectionId}/`)) continue;
        const data = await jpeg(env, key);
        if (data) photos.push({ mediaType: 'image/jpeg', data });
    }
    return photos;
}
