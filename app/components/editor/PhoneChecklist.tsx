import { useState } from "react";
import { Icon } from "@core/shared-ui";
import { ItemList, type SharedItemListProps } from "../editor-shared/ItemList";
import { FindingsIndicator } from "../editor-shared/FindingsIndicator";
import { hasIncludedFindings, type ItemTabs } from "../editor-shared/item-tab-projections";
import type { CollabFindingsApi } from "~/lib/collab/collab-findings-api";
import { FALLBACK_RATING_LEVELS, findRatingLevel, ratingForFindingsActivation } from "~/lib/rating-levels";
import { isItemComplete } from "~/lib/item-completeness";
import { checklistRowRating } from "./ChecklistRowRating";
import { checklistPhotoCount } from "./checklist-photos";
import { collectDefects } from "./report-search-rows";
import { m } from "~/paraglide/messages";

type Item = SharedItemListProps["items"][number] & { tabs?: ItemTabs };
export interface PhoneChecklistProps extends SharedItemListProps {
    findings: Pick<CollabFindingsApi, "getResult" | "setRating" | "addCustomLimitation">;
    allItems: Item[];
    defectCategories: Array<{ id: string; name: string }>;
    onAddPhoto: (itemId: string) => void;
}

/** Phone presentation of the shared list. Edit mode uses its existing menus and reorder handlers. */
export function PhoneChecklist({ findings, allItems, defectCategories, onAddPhoto, ...list }: PhoneChecklistProps) {
    const [editing, setEditing] = useState(false);
    const levels = list.ratingLevels?.length ? list.ratingLevels : FALLBACK_RATING_LEVELS;
    const sectionId = list.sectionId;
    const resultOf = (id: string) => findings.getResult(id, sectionId);
    const tabsOf = (id: string) => allItems.find(i => i.id === id)?.tabs ?? {};
    const defects = collectDefects([{ id: sectionId, items: allItems }], findings.getResult, defectCategories, { text: "" });
    const rated = allItems.filter(i => isItemComplete(resultOf(i.id))).length;
    const photos = allItems.reduce((n, i) => n + checklistPhotoCount(i.tabs ?? {}, resultOf(i.id)), 0);
    const upNext = allItems.find(i => !isItemComplete(resultOf(i.id)))?.id;
    const percent = allItems.length ? Math.round(rated / allItems.length * 100) : 0;
    const canEdit = !!(list.onMoveItem || list.onRenameItem || list.onDeleteItem);
    const controls = (id: string) => (
        <div className="flex shrink-0 items-center gap-10">
            <FindingsIndicator outlined active={hasIncludedFindings(tabsOf(id), resultOf(id))} onActivate={() => {
                const next = ratingForFindingsActivation(findRatingLevel(levels, resultOf(id).rating as string), levels);
                if (next && allItems.find(i => i.id === id)?.type === "rich") findings.setRating(sectionId, id, next);
                list.onSelect(id);
            }} />
            <button type="button" onClick={() => onAddPhoto(id)}
                aria-label={`${m.media_strip_add_photo_aria()} — ${allItems.find(i => i.id === id)?.label ?? ""}`}
                className="min-h-[48px] min-w-[72px] px-2 flex shrink-0 items-center justify-center gap-2 rounded-md border border-ih-border-strong text-ih-fg-2">
                <Icon name="camera" size={22} />
                {checklistPhotoCount(tabsOf(id), resultOf(id)) > 0 && <span className="text-[18px] font-bold tabular-nums">{checklistPhotoCount(tabsOf(id), resultOf(id))}</span>}
            </button>
        </div>
    );
    // Reuse the rating/Undo/NI-reason behavior; the phone row supplies its other actions beside it.
    const ratings = checklistRowRating(sectionId, list.items, levels, findings, controls);
    const summary = (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-ih-border" data-testid="checklist-summary">
            <span className="text-sm text-ih-fg-2 tabular-nums">{m.editor_shared_section_rated({ rated, total: allItems.length })} · <span className={defects.length ? "text-ih-bad-fg" : ""}>{m.editor_shared_section_findings({ count: defects.length, s: defects.length === 1 ? "" : "s" })}</span> · {m.editor_mobile_photos({ count: photos, s: photos === 1 ? "" : "s" })}</span>
            <div role="progressbar" aria-label={m.editor_mobile_percent_complete({ percent })} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
                className="ml-auto h-1.5 w-16 rounded-full bg-ih-bg-muted overflow-hidden">
                <div className="h-full bg-ih-ok" style={{ width: `${percent}%` }} />
            </div>
        </div>
    );
    return (
        <section data-testid="phone-checklist" className="-mx-4 -mt-4 [&_button]:min-h-[48px] [&_[role=radio][aria-checked=false]]:border-ih-border-strong">
            <ItemList {...list} header={summary} rowFooter={undefined} rowContent={editing || list.batchMode ? undefined : id => {
                const item = allItems.find(i => i.id === id);
                return (
                    <article className="px-4 pt-2 pb-1 border-b border-ih-border" aria-label={item?.label} data-item-id={id}>
                        <div className="flex items-start justify-between gap-3 mb-1">
                            <div className="min-w-0 flex flex-wrap items-center gap-2">
                                <h2 className="text-[18px] font-bold text-ih-fg-1 leading-snug"><button type="button" onClick={() => list.onSelect(id)} className="min-h-[48px] text-left">{item?.label}</button></h2>
                                {id === upNext && <span className="rounded-full border border-ih-primary/50 bg-ih-primary-tint px-2 py-1 text-[13px] font-semibold text-ih-primary-text">{m.editor_mobile_up_next()}</span>}
                            </div>
                            <button type="button" onClick={() => list.onSelect(id)} aria-label={`${m.editor_gate_facts_open()} — ${item?.label ?? ""}`}
                                className="-mt-2 -mr-2 min-h-[48px] px-2 flex shrink-0 items-center gap-2 text-sm font-semibold text-ih-primary-text">
                                {m.editor_gate_facts_open()}<Icon name="chevR" size={18} />
                            </button>
                        </div>
                        {item?.type === "rich" ? ratings(id) : <div className="pb-2">{controls(id)}</div>}
                        {defects.filter(d => d.itemId === id).map(d => (
                            <button type="button" key={d.cannedId} onClick={() => list.onSelect(id)} className="w-full min-h-[48px] flex items-start gap-2 py-2 text-left text-sm text-ih-bad-fg">
                                <span className="mt-1.5 w-2 h-2 shrink-0 rounded-full bg-ih-bad" aria-hidden="true" />
                                <span>{[d.title, d.severity, d.location].filter(Boolean).join(" · ")}</span>
                            </button>
                        ))}
                    </article>
                );
            }} />
            {canEdit && <button type="button" onClick={() => setEditing(!editing)} aria-pressed={editing}
                className="mx-4 my-2 min-h-12 px-2 text-[14px] text-ih-fg-3 underline underline-offset-4">
                {editing ? m.common_done() : `${m.common_edit()} ${m.editor_route_drawer_items()}`}
            </button>}
        </section>
    );
}
