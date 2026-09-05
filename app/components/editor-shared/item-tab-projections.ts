import type { CannedInfoComment, CannedDefect, CannedTabId } from "./canned-comment-types";

/** The template side of one item: the three canned-comment tabs it declares. */
export interface ItemTabs {
    information?: CannedInfoComment[];
    limitations?: CannedInfoComment[];
    defects?: CannedDefect[];
}

/**
 * Read-side projections over one item's result entry.
 *
 * Every function here answers the same question in a different shape: given
 * the TEMPLATE's canned entries for a tab and the INSPECTION's stored state for
 * that tab (`result.tabs[tabName]`, an array of `{ cannedId, … }` rows), what
 * did the inspector actually leave behind? They are pure — no component state,
 * no hooks — so the same answer is available anywhere the pair is in hand.
 *
 * They were closures inside `ItemEditor` until the large-file ratchet
 * (`scripts/check-file-size.mjs`) needed the room; the bodies are unchanged,
 * with `tabs` and `result` becoming parameters instead of captured variables.
 *
 * ⚠️ ONE IMPLEMENTATION, BECAUSE TWO WOULD DISAGREE. A second reading of "is
 * this canned entry included?" is how two surfaces start telling different
 * stories about what the inspector recorded. `FindingsIndicator` became that
 * second consumer, which is why this now sits in `editor-shared/` rather than
 * beside `ItemEditor`: anything rendering an item's recorded state reads it
 * from here.
 */

type ResultLike = Record<string, unknown>;

/**
 * Which canned IDs are included on a tab.
 *
 * A stored row WINS over the template's `default`; absent a row, the template
 * default decides. That precedence is the whole point — it is what lets an
 * inspector turn off a comment the template ships as on.
 */
export function getIncludedSet(tabs: ItemTabs, result: ResultLike, tabName: CannedTabId): Set<string> {
    const included = new Set<string>();
    const templateEntries = (tabs[tabName] || []) as Array<{ id: string; default: boolean }>;
    const stateEntries = ((result.tabs as Record<string, Array<{ cannedId: string; included: boolean }>> | undefined)?.[tabName]) || [];
    const stateMap = new Map<string, boolean>();
    for (const s of stateEntries) {
        stateMap.set(s.cannedId, s.included);
    }
    for (const entry of templateEntries) {
        const stateVal = stateMap.get(entry.id);
        // If there is a state override, use it; otherwise use the template default
        const isIncluded = stateVal !== undefined ? stateVal : entry.default;
        if (isIncluded) included.add(entry.id);
    }
    return included;
}

/**
 * Which of each comment's `choices` the inspector checked — mirrors
 * getIncludedSet's read of `result.tabs[tabName]` state entries, but keyed
 * by cannedId → selectedChoices rather than cannedId → included.
 */
export function getSelectedChoicesMap(result: ResultLike, tabName: CannedTabId): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const stateEntries = ((result.tabs as Record<string, Array<{ cannedId: string; selectedChoices?: string[] }>> | undefined)?.[tabName]) || [];
    for (const s of stateEntries) {
        if (Array.isArray(s.selectedChoices)) map.set(s.cannedId, s.selectedChoices);
    }
    return map;
}

/** The inspector's per-comment text override. Empty strings do not count. */
export function getCommentOverrideMap(result: ResultLike, tabName: CannedTabId): Map<string, string> {
    const map = new Map<string, string>();
    const stateEntries = ((result.tabs as Record<string, Array<{ cannedId: string; comment?: string | null }>> | undefined)?.[tabName]) || [];
    for (const s of stateEntries) {
        if (typeof s.comment === "string" && s.comment.length > 0) map.set(s.cannedId, s.comment);
    }
    return map;
}

/** The per-comment "needs follow-up" flag. Applies across all three tabs. */
export function getFlaggedMap(result: ResultLike, tabName: CannedTabId): Map<string, boolean> {
    const map = new Map<string, boolean>();
    const stateEntries = ((result.tabs as Record<string, Array<{ cannedId: string; flagged?: boolean }>> | undefined)?.[tabName]) || [];
    for (const s of stateEntries) {
        if (s.flagged) map.set(s.cannedId, true);
    }
    return map;
}

/**
 * Has the inspector flagged ANY comment on this item, on any tab?
 *
 * `getFlaggedMap` answers per-tab, which is what the comment list needs. A row
 * needs the whole item in one boolean: the flag is a note-to-self that this
 * comment must be revisited, and until now the ONLY place it appeared was the
 * toggle that set it plus a filter inside the search drawer. Flagging something
 * and then having to remember where you flagged it is the opposite of what the
 * flag is for.
 */
export function hasFlaggedComment(result: ResultLike): boolean {
    const tabs = (result.tabs as Record<string, Array<{ flagged?: boolean }>> | undefined) ?? {};
    return Object.values(tabs).some((entries) => entries?.some((s) => s.flagged));
}

/**
 * Does this item carry a finding? — the `F` of IN / NI / NP / F.
 *
 * ⚠️ DERIVED, NEVER STORED, AND DELIBERATELY NOT A RATING LEVEL. Spectora lights
 * `IN` and `F` on the same row at once, so they are two different questions:
 * IN/NI/NP is what the inspector DID with the item (one answer, mutually
 * exclusive), and F is whether anything is wrong with it (independent).
 * `ItemEntry.rating` holds a single scalar and `RatingSegment` is a
 * `role="radiogroup"`, so an `IN/NI/NP/F` rating preset would make choosing F
 * silently CLEAR IN — the report would then disagree with what the inspector
 * saw on screen, with nothing to catch it.
 * `findings-not-a-rating-level.test.ts` beside this file holds that line.
 *
 * Counts canned defects the template ships as `default: true` unless the
 * inspector turned them off (that is `getIncludedSet`'s precedence), plus any
 * per-inspection custom defect still marked included.
 */
export function hasIncludedFindings(tabs: ItemTabs, result: ResultLike): boolean {
    if (getIncludedSet(tabs, result, "defects").size > 0) return true;
    const custom = (result.customComments as { defects?: Array<{ included?: boolean }> } | undefined)?.defects ?? [];
    // `included` is required on CustomDefect and seeded true, so an absent flag
    // means a document older than the field — read it as included rather than
    // silently dropping a finding the inspector wrote by hand.
    return custom.some((d) => d.included !== false);
}

/** A canned defect's own photos[] (tabs.defects[].photos) — the STATE row's
 *  photo attachments, for both the count chip and the thumbnail strip. */
export function cannedDefectPhotos(
    result: ResultLike,
    cannedId: string,
): Array<{ key: string; annotatedKey?: string; croppedKey?: string }> {
    const rows = ((result.tabs as { defects?: Array<{ cannedId: string; photos?: Array<{ key: string; annotatedKey?: string; croppedKey?: string }> }> } | undefined)?.defects) ?? [];
    const row = Array.isArray(rows) ? rows.find((r) => r.cannedId === cannedId) : undefined;
    return Array.isArray(row?.photos) ? row.photos : [];
}
