import { useMemo, useState } from "react";
import {
    searchReport,
    countSearchResults,
    REPORT_SEARCH_KINDS,
    type ReportSearchKind,
} from "~/lib/report-search";
import { m } from "~/paraglide/messages";

export interface MobileReportSearchProps {
    sections: Array<{ id: string; title?: string; items?: Array<{ id: string; label?: string; tabs?: unknown }> }>;
    getResult: (itemId: string, sectionId: string) => Record<string, unknown> | undefined;
    /** Jump to a result — one history entry, so back returns to where you were. */
    onJump: (sectionId: string, itemId: string) => void;
}

const KIND_LABEL: Record<ReportSearchKind, () => string> = {
    information: () => m.editor_item_tab_information(),
    limitations: () => m.editor_item_tab_limitations(),
    defects: () => m.editor_item_tab_defects(),
};

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
 * The filters answer two different questions. Information / Limitations /
 * Defects narrow the TEMPLATE text being searched; Flagged and Incomplete
 * describe what the INSPECTOR recorded. That is why a state filter with an
 * empty query still returns items: "what did I flag?" and "what is still open?"
 * are real questions with no search text in them.
 */
export function MobileReportSearch({ sections, getResult, onJump }: MobileReportSearchProps) {
    const [text, setText] = useState("");
    const [kinds, setKinds] = useState<ReportSearchKind[]>([]);
    const [flaggedOnly, setFlaggedOnly] = useState(false);
    const [incompleteOnly, setIncompleteOnly] = useState(false);

    const results = useMemo(
        () => searchReport(sections as never, getResult as never, { text, kinds, flaggedOnly, incompleteOnly }),
        [sections, getResult, text, kinds, flaggedOnly, incompleteOnly],
    );
    const total = countSearchResults(results);
    const asked = Boolean(text.trim()) || flaggedOnly || incompleteOnly;

    const toggleKind = (k: ReportSearchKind) =>
        setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

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

            <div className="flex gap-2" role="group" aria-label={m.editor_search_kinds_aria()}>
                {REPORT_SEARCH_KINDS.map((k) => {
                    const on = kinds.includes(k);
                    return (
                        <button
                            key={k}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleKind(k)}
                            className={`flex-1 min-h-11 px-2 rounded-lg text-[12px] font-bold border transition-colors ${
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

            <div className="flex gap-4">
                {([
                    [m.editor_route_filter_flagged(), flaggedOnly, setFlaggedOnly] as const,
                    [m.editor_search_incomplete(), incompleteOnly, setIncompleteOnly] as const,
                ]).map(([label, on, set]) => (
                    <label key={label} className="flex items-center gap-2 min-h-11 text-[13px] text-ih-fg-2">
                        <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="w-4 h-4" />
                        {label}
                    </label>
                ))}
            </div>

            <p className="text-[11px] uppercase tracking-widest text-ih-fg-3" aria-live="polite">
                {asked
                    ? (total === 1 ? m.editor_search_result_count_one() : m.editor_search_result_count_other({ count: total }))
                    : m.editor_search_prompt()}
            </p>

            {results.map((section) => (
                <section key={section.sectionId} className="flex flex-col gap-1">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-ih-fg-3 mt-2">
                        {section.sectionTitle}
                    </h3>
                    {section.items.map((item) => (
                        <button
                            key={item.itemId}
                            type="button"
                            onClick={() => onJump(section.sectionId, item.itemId)}
                            className="text-left p-2.5 min-h-11 rounded-lg bg-ih-bg-app/50 hover:bg-ih-bg-muted"
                        >
                            <span className="text-[13px] font-bold text-ih-fg-1">{item.itemLabel}</span>
                            {/* State is shown, not just filtered on: a result list
                                that cannot say WHY an item is here makes the
                                inspector open it to find out. */}
                            {item.flagged && (
                                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-ih-watch-bg text-ih-watch-fg">
                                    {m.editor_route_filter_flagged()}
                                </span>
                            )}
                            {!item.complete && (
                                <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-ih-fg-3">
                                    {m.editor_search_incomplete()}
                                </span>
                            )}
                            {item.hits.slice(0, 2).map((hit) => (
                                <span key={hit.cannedId} className="block text-[11px] text-ih-fg-3 truncate">
                                    {hit.title}
                                </span>
                            ))}
                            {item.hits.length > 2 && (
                                <span className="block text-[10px] text-ih-fg-3">
                                    {m.editor_search_more_hits({ count: item.hits.length - 2 })}
                                </span>
                            )}
                        </button>
                    ))}
                </section>
            ))}
        </div>
    );
}
