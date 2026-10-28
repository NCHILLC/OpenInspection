import { getIncludedSet, hasFlaggedComment, itemHasFinding, type ItemTabs } from "../editor-shared/item-tab-projections";
import { findRatingLevel, type EditorRatingLevel } from "~/lib/rating-levels";
import { isItemComplete } from "~/lib/item-completeness";
import { m } from "~/paraglide/messages";

/** What the phone search's two tabs list (canvas X5). Pure: no hooks, no DOM. */

export interface SearchSection {
    id: string;
    title?: string;
    items?: Array<{ id: string; label?: string; tabs?: unknown }>;
}

type GetResult = (itemId: string, sectionId: string) => Record<string, unknown> | undefined;

/** "IN · 1 finding", "Not rated", "Not rated · up next". Empty for a done item with neither a rating nor a finding. */
export function itemStatusText(
    result: Record<string, unknown> | undefined,
    tabs: ItemTabs,
    levels: EditorRatingLevel[],
    upNext: boolean,
): string {
    const parts: string[] = [];
    const rating = (result?.rating as string | null | undefined) || null;
    if (rating) {
        const level = findRatingLevel(levels, rating);
        parts.push(level?.abbreviation ?? level?.label ?? level?.name ?? rating);
    } else if (!isItemComplete(result)) {
        parts.push(m.editor_followup_original_unrated());
        if (upNext) parts.push(m.editor_search_up_next());
    }
    if (itemHasFinding(tabs, result ?? {}, levels)) parts.push(m.editor_search_one_finding());
    return parts.join(" · ");
}

/** The first item, in report order, the inspector has not finished: the one "up next" points at. */
export function firstUnfinishedItemId(sections: SearchSection[], getResult: GetResult): string | null {
    for (const s of sections) for (const i of s.items ?? []) if (!isItemComplete(getResult(i.id, s.id))) return i.id;
    return null;
}

export interface DefectRow {
    sectionId: string;
    itemId: string;
    cannedId: string;
    title: string;
    /** "Roof › Gutters & Downspouts · Rear" */
    path: string;
    /** The tenant's severity name for this defect, "" when it has none. */
    severity: string;
    location: string;
}

interface StoredDefect { cannedId?: string; location?: string | null; category?: string | null; comment?: string | null }

/**
 * Every defect currently included in the report, one row each: the canned ones
 * the inspector left on (the stored row wins over the template default, same as
 * the editor) plus the ones they wrote by hand. `flaggedOnly` / `incompleteOnly`
 * are the item-level filters the Items tab already has.
 */
export function collectDefects(
    sections: SearchSection[],
    getResult: GetResult,
    categories: Array<{ id: string; name: string }>,
    query: { text: string; flaggedOnly?: boolean; incompleteOnly?: boolean },
): DefectRow[] {
    const text = query.text.trim().toLowerCase();
    const severityName = (raw: string | null | undefined) => {
        const v = (raw ?? "").trim();
        return categories.find((c) => c.id === v || c.name.toLowerCase() === v.toLowerCase())?.name ?? v;
    };
    const out: DefectRow[] = [];
    for (const section of sections) {
        for (const item of section.items ?? []) {
            const result = getResult(item.id, section.id) ?? {};
            if (query.flaggedOnly && !hasFlaggedComment(result)) continue;
            if (query.incompleteOnly && isItemComplete(result)) continue;
            const tabs = (item.tabs ?? {}) as ItemTabs;
            const stored = ((result.tabs as { defects?: StoredDefect[] } | undefined)?.defects ?? []);
            const path = (location: string | null | undefined) =>
                [section.title ?? "", item.label ?? ""].filter(Boolean).join(" › ") + (location ? ` · ${location}` : "");
            const push = (cannedId: string, title: string, comment: string, location: string | null | undefined, category: string | null | undefined) => {
                const row = { sectionId: section.id, itemId: item.id, cannedId, title, path: path(location), severity: severityName(category), location: location ?? "" };
                if (!text || `${title} ${comment} ${row.path} ${row.severity}`.toLowerCase().includes(text)) out.push(row);
            };
            const included = getIncludedSet(tabs, result, "defects");
            for (const d of tabs.defects ?? []) {
                if (!included.has(d.id)) continue;
                const st = stored.find((r) => r.cannedId === d.id);
                push(d.id, d.title, st?.comment || d.comment || "", st?.location || d.location, st?.category || d.category);
            }
            const custom = (result.customComments as { defects?: Array<{ id: string; title: string; comment?: string; included?: boolean; location?: string; category?: string }> } | undefined)?.defects ?? [];
            for (const d of custom) if (d.included !== false) push(d.id, d.title, d.comment ?? "", d.location, d.category);
        }
    }
    return out;
}

/** Defect rows grouped by severity in the tenant's own order (unknown or empty last), for "Moderate defects" headings. */
export function groupBySeverity(rows: DefectRow[], categories: Array<{ name: string }>): Array<{ severity: string; rows: DefectRow[] }> {
    const rank = (s: string) => {
        const i = categories.findIndex((c) => c.name === s);
        return i < 0 ? categories.length : i;
    };
    const groups = new Map<string, DefectRow[]>();
    for (const r of rows) groups.set(r.severity, [...(groups.get(r.severity) ?? []), r]);
    return [...groups].map(([severity, rs]) => ({ severity, rows: rs })).sort((a, b) => rank(a.severity) - rank(b.severity));
}
