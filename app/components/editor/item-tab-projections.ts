import type { CannedInfoComment, CannedDefect, CannedTabId } from "./CannedCommentTabs";

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
 * ⚠️ WHEN A SECOND SURFACE READS THIS STATE, IT READS IT HERE. The phone report
 * writer needs exactly these five answers to render an item, and a second
 * implementation of "is this canned entry included?" is how the two surfaces
 * start disagreeing about what the inspector recorded. Promote this module to
 * `editor-shared/` at that point rather than copying it.
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

/** FE-3 — photo count on a canned defect's STATE row (tabs.defects[].photos). */
export function cannedDefectPhotoCount(result: ResultLike, cannedId: string): number {
    const rows = ((result.tabs as { defects?: Array<{ cannedId: string; photos?: unknown[] }> } | undefined)?.defects) ?? [];
    const row = Array.isArray(rows) ? rows.find((r) => r.cannedId === cannedId) : undefined;
    return Array.isArray(row?.photos) ? row.photos.length : 0;
}
