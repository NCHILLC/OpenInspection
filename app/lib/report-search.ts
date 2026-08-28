import { isItemComplete } from "./item-completeness";

export type ReportSearchKind = "information" | "limitations" | "defects";

export const REPORT_SEARCH_KINDS: ReportSearchKind[] = ["information", "limitations", "defects"];

interface CannedEntry {
    id: string;
    title?: string;
    comment?: string;
}

interface SearchableItem {
    id: string;
    label?: string;
    tabs?: Partial<Record<ReportSearchKind, CannedEntry[]>>;
}

interface SearchableSection {
    id: string;
    title?: string;
    items?: SearchableItem[];
}

/** One canned entry that matched, with the tab it came from. */
interface ReportSearchHit {
    kind: ReportSearchKind;
    cannedId: string;
    title: string;
    snippet: string;
}

interface ReportSearchItemResult {
    itemId: string;
    itemLabel: string;
    /** True when the item itself matched (its label), independent of any hit. */
    labelMatched: boolean;
    hits: ReportSearchHit[];
    flagged: boolean;
    complete: boolean;
}

export interface ReportSearchSectionResult {
    sectionId: string;
    sectionTitle: string;
    items: ReportSearchItemResult[];
}

export interface ReportSearchQuery {
    text: string;
    /** Which tabs to search. Empty means all — a filter nobody set is not a filter. */
    kinds?: ReportSearchKind[];
    flaggedOnly?: boolean;
    incompleteOnly?: boolean;
}

type ResultLike = { rating?: unknown; value?: unknown; tabs?: Partial<Record<ReportSearchKind, Array<{ cannedId: string; flagged?: boolean }>>> };

const norm = (s: string) => s.toLowerCase().trim();

/** Does any of this item's recorded canned state carry the follow-up flag? */
function isFlagged(result: ResultLike | undefined): boolean {
    if (!result?.tabs) return false;
    for (const kind of REPORT_SEARCH_KINDS) {
        if ((result.tabs[kind] ?? []).some((row) => row.flagged)) return true;
    }
    return false;
}

/**
 * Search one inspection's template text, filtered by what the inspector recorded.
 *
 * ⚠️ THE TWO AXES COME FROM DIFFERENT PLACES AND THAT IS THE WHOLE DIFFICULTY.
 * The kind filters (Information / Limitations / Defects) partition TEMPLATE
 * content; Flagged and Incomplete describe INSPECTION state. A hit therefore
 * has to be matched against one and then tested against the other, and an item
 * can satisfy the state filters while containing no textual match at all —
 * which is why an empty query still returns items when a state filter is on.
 * Searching for nothing among flagged items is a real question ("what did I
 * flag?"), and returning nothing for it would be wrong.
 *
 * `Incomplete` reads `isItemComplete`, the same predicate the progress ring and
 * the section rail use. A filter that disagreed with the ring would send an
 * inspector hunting for work the display calls finished.
 */
export function searchReport(
    sections: SearchableSection[],
    getResult: (itemId: string, sectionId: string) => ResultLike | undefined,
    query: ReportSearchQuery,
): ReportSearchSectionResult[] {
    const text = norm(query.text ?? "");
    const kinds = query.kinds?.length ? query.kinds : REPORT_SEARCH_KINDS;
    const out: ReportSearchSectionResult[] = [];

    for (const section of sections) {
        const items: ReportSearchItemResult[] = [];

        for (const item of section.items ?? []) {
            const result = getResult(item.id, section.id);
            const flagged = isFlagged(result);
            const complete = isItemComplete(result);

            if (query.flaggedOnly && !flagged) continue;
            if (query.incompleteOnly && complete) continue;

            const hits: ReportSearchHit[] = [];
            for (const kind of kinds) {
                for (const entry of item.tabs?.[kind] ?? []) {
                    const title = entry.title ?? "";
                    const body = entry.comment ?? "";
                    if (!text || norm(title).includes(text) || norm(body).includes(text)) {
                        hits.push({ kind, cannedId: entry.id, title, snippet: body });
                    }
                }
            }

            const labelMatched = Boolean(text) && norm(item.label ?? "").includes(text);

            // With text, an item earns its place by matching something. Without
            // text, a state filter is the query — every item that survived it
            // belongs in the results even with no hits to show.
            const stateFiltered = Boolean(query.flaggedOnly || query.incompleteOnly);
            if (text ? hits.length > 0 || labelMatched : stateFiltered) {
                items.push({
                    itemId: item.id,
                    itemLabel: item.label ?? "",
                    labelMatched,
                    hits,
                    flagged,
                    complete,
                });
            }
        }

        if (items.length > 0) {
            out.push({ sectionId: section.id, sectionTitle: section.title ?? "", items });
        }
    }

    return out;
}

/** Total matched items, for the "N results" line. */
export function countSearchResults(sections: ReportSearchSectionResult[]): number {
    return sections.reduce((n, s) => n + s.items.length, 0);
}
