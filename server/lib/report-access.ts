// server/lib/report-access.ts
import { isReportPublished } from './status/report-status';

/**
 * Decide whether a PUBLIC report-access request may proceed.
 * Client/token access is allowed only while the report is currently published
 * AND the order's delivery gate is clear. Owner-preview and headless
 * render-token access always bypass (they must be able to load
 * in-progress/unpublished reports for editing/preview/rendering).
 * Reads CURRENT report_status — re-publishing restores access automatically.
 *
 * THE CONTENT IS GATED BY THE SAME RESOLVER THE HUB'S LOCK NOTICE SHOWS.
 * `resolveGate` is InspectionService.getReportGate: non-null = an unsigned
 * required agreement or an unpaid required invoice, which withholds the report
 * itself and not only the banner explaining it. Passed as a thunk so it is
 * consulted once, on the one path that can serve content — never on a bypass
 * or an unpublished report, which are already refused.
 */
export async function publicReportAccessAllowed(opts: {
  renderMode: boolean;
  ownerPreview: boolean;
  reportStatus: string | null | undefined;
  resolveGate: () => Promise<unknown>;
}): Promise<boolean> {
  if (opts.renderMode || opts.ownerPreview) return true;
  if (!isReportPublished(opts.reportStatus)) return false;
  return (await opts.resolveGate()) == null;
}

/**
 * Decide whether this read should be PINNED to the latest published version's
 * snapshot rather than resolved from live tables.
 *
 * Only the recipient track is pinned, and the two exclusions are not symmetric
 * with the access gate above — which is exactly why this is its own function
 * instead of a second `renderMode || ownerPreview` inline:
 *
 *  - RENDER TOKEN carries its own version and must keep it; the verify page
 *    materialises one specific version, not "the latest".
 *  - OWNER PREVIEW stays LIVE. The owner is the author, and preview exists to
 *    show work in progress — pinning it would hide every edit made since the
 *    last publish, which is the plan's split: publish → snapshot, live/draft
 *    preview → read current state.
 *
 * A draft has no version row, so the caller resolves nothing and falls through
 * to live. Nothing here consults the query string: the version is always
 * server-derived, so a link holder cannot ask for a version they were not sent.
 */
export function shouldPinLatestPublished(opts: {
  renderMode: boolean;
  ownerPreview: boolean;
  /** A version already named by a signed render token, if any. */
  tokenPinnedVersion: number | undefined;
}): boolean {
  if (opts.tokenPinnedVersion !== undefined) return false;
  return !opts.renderMode && !opts.ownerPreview;
}
