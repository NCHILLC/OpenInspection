import { useMemo, useState } from "react";
import {
    searchReport,
    REPORT_SEARCH_KINDS,
    type ReportSearchKind,
} from "~/lib/report-search";
import type { EditorRatingLevel } from "~/lib/rating-levels";
import { hasFlaggedComment, type ItemTabs } from "../editor-shared/item-tab-projections";
import { collectDefects, firstUnfinishedItemId, groupBySeverity, itemStatusText } from "./report-search-rows";
import { m } from "~/paraglide/messages";

export interface MobileReportSearchProps {
    sections: Array<{ id: string; title?: string; items?: Array<{ id: string; label?: string; tabs?: unknown }> }>;
    getResult: (itemId: string, sectionId: string) => Record<string, unknown> | undefined;
    /** Jump to a result — one history entry, so back returns to where you were. */
    onJump: (sectionId: string, itemId: string) => void;
    /** For the rating shown on each row; without them a rated item reads as its raw rating id. */
    ratingLevels?: EditorRatingLevel[];
    /** The tenant's defect severities, to name each defect row's severity. */
    defectCategories?: Array<{ id: string; name: string }>;
}

const KIND_LABEL: Record<ReportSearchKind, () => string> = {
    information: () => m.editor_item_tab_information(),
    limitations: () => m.editor_item_tab_limitations(),
    defects: () => m.editor_item_tab_defects(),
};

/** What the Items tab lists: the search's own result shape, or the whole report in the same shape when nothing is asked. */
type ItemsBySection = Array<{
    sectionId: string;
    sectionTitle: string;
    items: Array<{ itemId: string; itemLabel: string; flagged: boolean; hits: Array<{ cannedId: string; title: string }> }>;
}>;

const ROW = "text-left p-2.5 min-h-16 rounded-lg bg-ih-bg-app/50 hover:bg-ih-bg-muted";
const GROUP_HEADING = "text-[14px] font-bold uppercase tracking-widest text-ih-fg-3 mt-2";

/**
 * Search one inspection, on a phone.
 *
 * ⚠️ NOT A LEVEL OF THE DRILL-DOWN STACK. Search is somewhere you go and come
 * back from, not a step between the section list and an item — putting it in
 * the stack would make "back" from a result land in the search screen, then the
 * section list, then wherever you started. It is a sheet, and a result jumps
 * straight to its item in ONE history entry, so back returns to the screen the
 * inspector actually came from.
 *
 * Canvas X5: an Items tab and a Defects tab, each with its count. Items is the
 * search below (template text plus item names); Defects lists the defects now in
 * the report, with their path and severity. The query and the filters apply to
 * both tabs. With nothing asked, both list everything: the tabs are a way to
 * browse the report as well as search it.
 *
 * The filters answer two different questions. Information / Limitations /
 * Defects narrow the TEMPLATE text being searched; Flagged and Incomplete
 * describe what the INSPECTOR recorded. That is why a state filter with an
 * empty query still returns items: "what did I flag?" and "what is still open?"
 * are real questions with no search text in them.
 */
export function MobileReportSearch({ sections, getResult, onJump, ratingLevels = [], defectCategories = [] }: MobileReportSearchProps) {
    const [tab, setTab] = useState<"items" | "defects">("items");
    const [text, setText] = useState("");
    const [kinds, setKinds] = useState<ReportSearchKind[]>([]);
    const [flaggedOnly, setFlaggedOnly] = useState(false);
    const [incompleteOnly, setIncompleteOnly] = useState(false);

    const query = text.trim();
    const asked = Boolean(query) || flaggedOnly || incompleteOnly;
    const results = useMemo<ItemsBySection>(
        () => asked
            ? searchReport(sections as never, getResult as never, { text, kinds, flaggedOnly, incompleteOnly })
            : sections.map((s) => ({
                sectionId: s.id,
                sectionTitle: s.title ?? "",
                items: (s.items ?? []).map((i) => ({
                    itemId: i.id,
                    itemLabel: i.label ?? "",
                    hits: [],
                    flagged: hasFlaggedComment(getResult(i.id, s.id) ?? {}),
                })),
            })),
        [asked, sections, getResult, text, kinds, flaggedOnly, incompleteOnly],
    );
    const defects = useMemo(
        () => collectDefects(sections, getResult, defectCategories, { text, flaggedOnly, incompleteOnly }),
        [sections, getResult, defectCategories, text, flaggedOnly, incompleteOnly],
    );
    const upNextId = useMemo(() => firstUnfinishedItemId(sections, getResult), [sections, getResult]);
    const itemCount = results.reduce((n, s) => n + s.items.length, 0);
    const empty = (tab === "items" ? itemCount : defects.length) === 0;

    const toggleKind = (k: ReportSearchKind) =>
        setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
    const tabsOf = (sectionId: string, itemId: string) =>
        (sections.find((s) => s.id === sectionId)?.items?.find((i) => i.id === itemId)?.tabs ?? {}) as ItemTabs;

    return (
        <div className="p-4 flex flex-col gap-3" data-testid="mobile-report-search">
            <input
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={m.editor_search_placeholder()}
                aria-label={m.editor_search_placeholder()}
                className="w-full h-11 px-3 rounded-lg bg-ih-bg-app border border-ih-border text-[15px] text-ih-fg-1"
            />

            <div role="tablist" aria-label={m.editor_search_tabs_aria()} className="flex border-b border-ih-border-strong">
                {([["items", m.editor_route_drawer_items(), itemCount], ["defects", m.editor_item_tab_defects(), defects.length]] as const).map(([id, label, count]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                        className={`flex-1 min-h-13 flex items-center justify-center gap-2 text-[16px] border-b-[3px] ${tab === id ? "font-bold text-ih-fg-1 border-ih-primary" : "font-semibold text-ih-fg-3 border-transparent"}`}
                    >
                        {label}
                        <span className="min-w-6 h-6 px-1.5 rounded-full bg-ih-bg-muted text-[14px] font-extrabold tabular-nums flex items-center justify-center">{count}</span>
                    </button>
                ))}
            </div>

            {/* The comment-type chips narrow the template text the Items tab searches; the Defects tab has no use for them. */}
            {tab === "items" && (
                <div className="flex gap-2" role="group" aria-label={m.editor_search_kinds_aria()}>
                    {REPORT_SEARCH_KINDS.map((k) => {
                        const on = kinds.includes(k);
                        return (
                            <button
                                key={k}
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggleKind(k)}
                                className={`flex-1 min-h-11 px-2 rounded-lg text-[15px] font-bold border transition-colors ${
                                    on
                                        ? "bg-ih-primary-tint border-ih-primary/40 text-ih-fg-1"
                                        : "bg-transparent border-ih-border text-ih-fg-3"
                                }`}
                            >
                                {KIND_LABEL[k]()}
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="flex gap-4">
                {([
                    [m.editor_route_filter_flagged(), flaggedOnly, setFlaggedOnly] as const,
                    [m.editor_search_incomplete(), incompleteOnly, setIncompleteOnly] as const,
                ]).map(([label, on, set]) => (
                    <label key={label} className="flex items-center gap-2 min-h-11 text-[16px] text-ih-fg-2">
                        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="w-4 h-4" />
                        {label}
                    </label>
                ))}
            </div>

            {empty && (
                <p className="text-[16px] text-ih-fg-3" aria-live="polite">
                    {query ? m.editor_search_empty({ query }) : m.editor_search_prompt()}
                </p>
            )}

            {tab === "items" && results.filter((s) => s.items.length > 0).map((section) => (
                <section key={section.sectionId} className="flex flex-col gap-1">
                    <h3 className={GROUP_HEADING}>{section.sectionTitle}</h3>
                    {section.items.map((item) => {
                        const status = itemStatusText(
                            getResult(item.itemId, section.sectionId),
                            tabsOf(section.sectionId, item.itemId),
                            ratingLevels,
                            item.itemId === upNextId,
                        );
                        return (
                            <button key={item.itemId} type="button" onClick={() => onJump(section.sectionId, item.itemId)} className={ROW}>
                                <span className="text-[17px] font-bold text-ih-fg-1">{item.itemLabel}</span>
                                {/* State is shown, not just filtered on: a result list
                                    that cannot say WHY an item is here makes the
                                    inspector open it to find out. */}
                                {item.flagged && (
                                    <span className="ml-2 px-1.5 py-0.5 rounded text-[13px] font-bold uppercase tracking-wider bg-ih-watch-bg text-ih-watch-fg">
                                        {m.editor_route_filter_flagged()}
                                    </span>
                                )}
                                {status && <span className="block text-[15px] text-ih-fg-3">{status}</span>}
                                {item.hits.slice(0, 2).map((hit) => (
                                    <span key={hit.cannedId} className="block text-[14px] text-ih-fg-3 truncate">
                                        {hit.title}
                                    </span>
                                ))}
                                {item.hits.length > 2 && (
                                    <span className="block text-[13px] text-ih-fg-3">
                                        {m.editor_search_more_hits({ count: item.hits.length - 2 })}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </section>
            ))}

            {tab === "defects" && groupBySeverity(defects, defectCategories).map((group) => (
                <section key={group.severity} className="flex flex-col gap-1">
                    <h3 className={GROUP_HEADING}>
                        {group.severity ? m.editor_search_defect_group({ severity: group.severity }) : m.editor_item_tab_defects()}
                    </h3>
                    {group.rows.map((d) => (
                        <button key={`${d.itemId}:${d.cannedId}`} type="button" onClick={() => onJump(d.sectionId, d.itemId)} className={ROW}>
                            <span className="text-[17px] font-bold text-ih-fg-1">{d.title}</span>
                            <span className="block text-[15px] text-ih-fg-3">{d.path}</span>
                        </button>
                    ))}
                </section>
            ))}
        </div>
    );
}
