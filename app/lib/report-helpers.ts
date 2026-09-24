/**
 * Pure report helpers — formatting / derivation only (no React, no hooks).
 *
 * Extracted from <ReportView> so the section-icon mapping, defect predicate,
 * signature/verification models and the two date formatters can be unit-tested
 * and reused without pulling in the component. Behavior-preserving: the bodies
 * are byte-identical to their former in-component definitions.
 */

import { formatDate } from "./format";

/* ------------------------------------------------------------------ */
/* Section icon mapping */
/* ------------------------------------------------------------------ */

const SECTION_ICONS: Record<string, string> = {
  roof: "🏠",
  exterior: "🏗️",
  electrical: "⚡",
  plumbing: "🔧",
  hvac: "❄️",
  interior: "🛋️",
  structural: "🏛️",
  appliances: "🔌",
};

export function getSectionIcon(title: string): string {
  const key = title.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(SECTION_ICONS)) {
    if (key.includes(k)) return v;
  }
  return "📋";
}

/* ------------------------------------------------------------------ */
/* Filter helpers */
/* ------------------------------------------------------------------ */

/**
 * Whether an item reaches the Summary. Reads the first-class, per-category switch
 * the tenant configures: defect_categories.drivesSummary, resolved server-side
 * onto each ResolvedDefect. An item drives the summary when it has at least one
 * included defect whose category drives the summary (unset → default true).
 *
 * It used to gate the "Defects Only" filter and repair-request checkbox, which made them
 * disappear for real defects: every category a tenant defines IS a defect (Minor,
 * Moderate and Safety/Major alike), so switching one out of the Summary was
 * also switching it out of the only view that claimed to list defects, leaving
 * no view that showed them all. Spectora, whose model this follows, scopes the
 * same setting to "the summary web report and the summary PDF". The filter now
 * asks itemHasDefect instead; this answers only the Summary question.
 */
export function itemDrivesSummary(item: {
  resolvedTabs?: { defects?: Array<{ included: boolean; drivesSummary?: boolean }> };
}): boolean {
  return (item.resolvedTabs?.defects ?? []).some((d) => d.included && d.drivesSummary !== false);
}

/**
 * Whether anything was found on this item at all, whatever category it was
 * filed under. This is the "Defects Only" question, and it is deliberately
 * blind to `drivesSummary`: which categories reach the Summary is a delivery
 * choice, and it must not change what the report says is wrong with the house.
 * It also gates the "add to repair request" checkbox: any finding can go on a
 * repair request, not only the ones that reach the Summary.
 */
export function itemHasDefect(item: {
  resolvedTabs?: { defects?: Array<{ included: boolean }> };
}): boolean {
  return (item.resolvedTabs?.defects ?? []).some((d) => d.included);
}

/** The shape every filter narrows — structural, so this file stays free of the
 *  report's component types (the rest of the module is written the same way). */
export interface FilterableSection {
  items: Array<{ resolvedTabs?: { defects?: Array<{ included: boolean; drivesSummary?: boolean }> } }>;
}

/**
 * The sections a report filter shows, narrowed on the axis that filter means.
 *
 * `defects` lists every included finding, whatever its rating or category.
 * `summary` lists only included findings from categories selected for delivery.
 * A mixed-category item must lose its excluded findings in the Summary too.
 *
 * `summary` used to narrow NEITHER: it rendered a per-section count card and
 * hid every finding, so the switch a tenant sets to choose what reaches the
 * Summary drove the Defects view and never the Summary — both halves of one
 * mix-up, and this fixes the second.
 */
export function sectionsForFilter<S extends FilterableSection>(
  sections: readonly S[],
  filter: "all" | "defects" | "summary",
): S[] {
  if (filter === "all") return [...sections];
  const summaryDriving = (s: S): S => ({
    ...s,
    items: s.items.filter(itemDrivesSummary).map((item) => ({
      ...item,
      resolvedTabs: {
        ...item.resolvedTabs,
        defects: item.resolvedTabs?.defects?.filter((d) => d.included && d.drivesSummary !== false),
      },
    })),
  });
  if (filter === "defects") {
    return sections.map((s) => ({ ...s, items: s.items.filter(itemHasDefect) })).filter((s) => s.items.length > 0);
  }
  // A section with nothing to report stays OUT of the summary. It does not
  // appear saying "All clear" — the summary is the list of what was found, and
  // a heading with no finding under it is noise in the document someone reads
  // standing at a front door. The section's rating-derived `defectCount` is not
  // consulted by any filter: it can be zero while an unrated item has a finding.
  return sections.map(summaryDriving).filter((s) => s.items.length > 0);
}

/**
 * An item the inspector never answered.
 *
 * `inspection-report.service` sets `rating` to `res.rating ?? null` and
 * `ratingLabel` to `level?.label ?? ratingId`, so an unanswered item arrives with
 * BOTH null — no pill, no `naKind`, and on a report that was published part-done
 * usually no notes, no defects and no photos either. The card then rendered a
 * bordered box containing nothing but the item's own title, which a recipient
 * cannot tell apart from "inspected, nothing to report". On an inspection report
 * that difference is the whole liability question, and it lands on the commonest
 * case there is: a report published before it was finished (19 of 36 production
 * inspections have no content at all).
 *
 * ⚠️ UNRATED IS NOT THE `Not Inspected` RATING. That one is an answer — the
 * component was there and the inspector says why they did not inspect it, and it
 * renders through `naKind` with its reason. This is the absence of an answer.
 *
 * WHY `type` GATES IT. Only `rich` items carry `ratingOptions`; a `number` /
 * `text` / `boolean` item ("Year built · 1995") is a data field and has no rating
 * to miss. Marking those "Unrated" would invent a gap. `type` is optional on the
 * wire and `rich` is the service's own default, so absent reads as rich.
 */
export function itemIsUnrated(item: { type?: string; rating: string | null }): boolean {
  return (item.type ?? "rich") === "rich" && !item.rating;
}

/* ------------------------------------------------------------------ */
/* Signature + verification pure helpers (exported for tests) */
/* ------------------------------------------------------------------ */

/**
 * What the report may say about who stands behind it.
 *
 * `variant` mirrors a DOMAIN state the service decided — it is not inferred
 * here. There used to be a `"typed"` variant that drew the inspector's NAME in
 * a display font on a ruled line, captioned "Electronically signed by", and it
 * was reached whenever a published report had no signature record at all. The
 * report claimed a signing event that had not happened, on 7 of 7 published
 * reports in production.
 *
 *   attribution  nobody signed. Name the author, with NO signing verb.
 *   none         nobody signed AND there is no name — render nothing at all.
 *                "Inspected & Signed By" over an empty name attributes the
 *                report to nobody, which is the composed-signature defect one
 *                field along. Distinct from `draft`, which says the report is
 *                unpublished; this one is published and simply has no author to
 *                name.
 *   image        the inspector signed; render their signature.
 *   auto         the inspector's signature, applied under the standing
 *                authorisation they enabled — same signature, different
 *                provenance, and the document has to say which.
 *   draft        not published.
 *
 * Never synthesize a signature from a person's name (2026-08-15). That is the
 * invariant this type exists to hold.
 */
export interface SignatureBlockResult {
  variant: "image" | "auto" | "attribution" | "none" | "draft";
  inspectorName?: string;
  license?: string | null;
  signedAt?: number | null;
  signatureBase64?: string | null;
  showNudge: boolean;
}

export function signatureBlockModel(d: {
  isPublished: boolean;
  signature: {
    /** Domain state from the service. Never inferred from the other fields. */
    method: "none" | "manual" | "authorized_auto";
    signatureBase64: string | null;
    signedAt?: number | null;
    /** NULL when the account carries no name. Never synthesised — see `none`. */
    inspectorName: string | null;
    inspectorLicense?: string | null;
  } | null;
  ownerPreview: boolean;
}): SignatureBlockResult {
  if (!d.isPublished || !d.signature) return { variant: "draft", showNudge: false };
  const base = {
    inspectorName: d.signature.inspectorName ?? undefined,
    license: d.signature.inspectorLicense ?? null,
    signedAt: d.signature.signedAt ?? null,
  };
  // Read the state; do not re-derive it. `method` is the service's answer, and
  // the presence of an image is a consequence of it rather than evidence for it.
  switch (d.signature.method) {
    case "manual":
      return { variant: "image", signatureBase64: d.signature.signatureBase64 ?? null, showNudge: false, ...base };
    case "authorized_auto":
      return { variant: "auto", signatureBase64: d.signature.signatureBase64 ?? null, showNudge: false, ...base };
    default:
      // No signature. With a name, the READER sees authorship and nothing that
      // reads as a signing act; the nudge still shows the owner how to add one.
      // With no name there is nothing to attribute, so nothing is drawn — a
      // heading over an empty name is an assertion about nobody.
      if (!d.signature.inspectorName) return { variant: "none", showNudge: false };
      return { variant: "attribution", showNudge: d.ownerPreview, ...base, signedAt: null };
  }
}

export interface VerificationBlockResult {
  show: boolean;
  verifyUrl: string;
  shortHash: string;
  versionNumber: number;
  publishedAt: number;
}

export function verificationBlockModel(
  d: {
    verification: {
      versionNumber: number;
      contentHash: string;
      verifyToken: string;
      publishedAt: number;
    } | null;
  },
  baseUrl: string,
): VerificationBlockResult {
  if (!d.verification) return { show: false, verifyUrl: "", shortHash: "", versionNumber: 0, publishedAt: 0 };
  return {
    show: true,
    verifyUrl: `${baseUrl}/v/${d.verification.verifyToken}`,
    shortHash: d.verification.contentHash.slice(0, 8),
    versionNumber: d.verification.versionNumber,
    publishedAt: d.verification.publishedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Date formatting helpers for signature/verification blocks */
/* ------------------------------------------------------------------ */

// Report timestamps anchor to the tenant timezone + locale (passed by the caller).
// Defaults 'UTC'/'en-US' preserve behaviour when a caller has none to hand; the
// render goes through the shared formatter (month:'short', numeric day + year).
export function formatEpochMs(ms: number | null | undefined, timeZone = "UTC", locale = "en-US"): string {
  return formatDate(ms, { locale, timeZone, month: "short" });
}

export function formatUnixSeconds(sec: number, timeZone = "UTC", locale = "en-US"): string {
  return formatDate(sec * 1000, { locale, timeZone, month: "short" });
}
