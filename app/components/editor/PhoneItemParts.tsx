import type { ReactNode } from "react";
import { getIncludedSet, type ItemTabs } from "../editor-shared/item-tab-projections";
import type { CannedTabId } from "../editor-shared/canned-comment-types";
import type { DefectFieldsValue } from "./DefectFieldsRow";
import { m } from "~/paraglide/messages";

/**
 * The phone's item screen (canvas S05) differs from the desktop item pane in
 * layout only: tabs read Defects · Info · Limits · Notes, and a bar says when a
 * defect cannot publish yet. These pieces live here because `ItemEditor` and
 * `CannedCommentTabs` sit at their size caps.
 */

/** A tab the phone adds after the canned ones; its panel replaces the canned list. */
export interface ExtraTab { id: string; label: string; active: boolean; onSelect: () => void; panel: ReactNode }

const PHONE_ORDER: CannedTabId[] = ["defects", "information", "limitations"];

/** Defects first (finding what is wrong is the job in the field), short labels. */
export function phoneTabs<T extends { id: CannedTabId; label: string }>(tabs: T[]): T[] {
    return [...tabs]
        .sort((a, b) => PHONE_ORDER.indexOf(a.id) - PHONE_ORDER.indexOf(b.id))
        .map((t) => ({ ...t, label: t.id === "information" ? m.editor_item_tab_info_short() : t.id === "limitations" ? m.editor_item_tab_limits_short() : t.label }));
}

/**
 * Included template defects on this item that the publish gate will block for a
 * missing location. Mirrors `computePublishReadinessFromState` (server): only
 * template defects are checked, and a location on the template entry counts.
 * `required` is the effective policy; `flagged` adds what the last gate run reported.
 */
export function missingLocationCount(
    tabs: ItemTabs,
    result: Record<string, unknown>,
    defectStates: Map<string, DefectFieldsValue> | undefined,
    required: boolean,
    flagged: Map<string, { location: boolean }> | undefined,
): number {
    let n = 0;
    for (const id of getIncludedSet(tabs, result, "defects")) {
        const tpl = (tabs.defects ?? []).find((d) => d.id === id);
        if (!tpl) continue;
        const has = !!defectStates?.get(id)?.location || !!tpl.location;
        if (!has && (required || flagged?.get(id)?.location)) n++;
    }
    return n;
}

/** Canvas X3: pinned above the rating strip (72px frame bar + 56px strip). */
export function LocationNeededBar({ count }: { count: number }) {
    if (count === 0) return null;
    return (
        <>
            {/* Keeps the end of the scroll clear of the bar. */}
            <div aria-hidden className="h-12 md:hidden order-last" />
            {/* The tint is translucent: the app background under it keeps scrolled content from showing through. */}
            <div role="status" className="md:hidden fixed inset-x-0 bottom-32 z-30 bg-ih-bg-app"><div className="min-h-12 px-4 flex items-center gap-2 bg-ih-watch-bg border-t border-ih-watch/50 text-ih-watch-fg text-[16px] font-bold">
                <svg className="w-5 h-5 flex-none" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>
                <span>{count === 1 ? m.editor_item_location_needed_one() : m.editor_item_location_needed_other({ count })}</span>
            </div></div>
        </>
    );
}
