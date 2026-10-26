import { useState } from "react";
import { Icon } from "@core/shared-ui";
import { DefectCategoryChip } from "../editor-shared/DefectCategoryChip";
import { BUILT_IN_DEFECT_CATEGORIES, deriveDefectTitle } from "../../lib/custom-defects";
import { htmlToPlainText } from "../../lib/html-text";
import type { CannedCommentTabsProps } from "./CannedCommentTabs";
import { m } from "~/paraglide/messages";

/**
 * Canvas S06: on the phone, the Defects tab's search box is a button that opens
 * this full screen. It drives the same state as the desktop's inline search
 * (query, library hits, the custom-defect draft), so a defect added here is the
 * same defect the desktop adds; only the layout differs.
 */

const eyebrow = "text-[14px] font-bold uppercase tracking-[0.08em] text-ih-fg-3";
const field = "w-full rounded-lg border border-ih-border-strong bg-ih-bg-app text-[17px] text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus";
const bar = "fixed inset-x-0 bottom-0 h-18 flex items-center gap-2 px-3 bg-ih-bg-card border-t border-ih-border";
const addBtn = (on: boolean) =>
    `flex-none min-w-19 h-12 px-3 rounded-md text-[16px] font-extrabold ${on ? "bg-ih-primary text-ih-primary-fg" : "border border-ih-border-strong text-ih-fg-2"}`;

export function PhoneDefectSearch(props: CannedCommentTabsProps & { itemLabel: string }) {
    const [open, setOpen] = useState(false);
    const [writing, setWriting] = useState(false);
    const q = props.defectQuery.trim();
    const close = () => { setOpen(false); setWriting(false); props.onDefectQueryChange(""); };
    const count = props.includedSet.size + props.customDefects.filter((d) => d.included !== false).length;
    const categories = [
        ...BUILT_IN_DEFECT_CATEGORIES.map((id) => ({ id, name: { safety: m.editor_customdefect_category_safety, recommendation: m.editor_customdefect_category_recommendation, maintenance: m.editor_customdefect_category_maintenance }[id]() })),
        ...(props.customCategories ?? []).filter((c) => !BUILT_IN_DEFECT_CATEGORIES.includes(c.name.trim().toLowerCase() as (typeof BUILT_IN_DEFECT_CATEGORIES)[number])),
    ];

    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)} className="w-full h-13 mb-2 px-3.5 flex items-center gap-2.5 rounded-lg border border-ih-border-strong bg-ih-bg-card text-[17px] text-ih-fg-3">
                <Icon name="search" size={20} />{m.editor_defectsearch_open()}
            </button>
        );
    }

    return (
        <div role="dialog" aria-modal="true" aria-labelledby="defect-search-title" onKeyDown={(e) => e.key === "Escape" && close()}
            className="fixed inset-0 z-50 flex flex-col bg-ih-bg-app text-ih-fg-1">
            <header className="h-16 flex-none flex items-center gap-1 px-1 border-b border-ih-border">
                <button type="button" onClick={close} aria-label={m.editor_defectsearch_close()} className="w-12 h-12 flex items-center justify-center rounded-md text-ih-fg-2">
                    <Icon name="x" size={24} />
                </button>
                <div className="flex-1 min-w-0 pl-1">
                    <div className={`${eyebrow} truncate`}>{props.itemLabel}</div>
                    <h2 id="defect-search-title" className="text-[22px] leading-tight font-bold">{writing ? m.editor_defectsearch_write_title() : m.editor_defectsearch_title()}</h2>
                </div>
            </header>

            {writing ? (
                <>
                    <main className="flex-1 overflow-y-auto px-4 pt-3 pb-22 flex flex-col gap-3.5">
                        <label className={`${eyebrow} flex flex-col gap-1.5`}>{m.editor_defectsearch_title_label()}
                            <input value={props.customTitle} onChange={(e) => props.onCustomTitleChange(e.target.value)} className={`${field} h-13 px-3.5 font-semibold normal-case tracking-normal`} />
                        </label>
                        <label className={`${eyebrow} flex flex-col gap-1.5`}>{m.editor_defectsearch_client_reads()}
                            <textarea rows={4} value={props.customComment} onChange={(e) => props.onCustomCommentChange(e.target.value)} placeholder={m.editor_defectsearch_client_placeholder()} className={`${field} px-3.5 py-3 resize-none font-normal normal-case tracking-normal placeholder:text-ih-fg-4`} />
                        </label>
                        <div className="flex flex-col gap-1.5">
                            <div id="defect-search-severity" className={eyebrow}>{m.editor_defectsearch_severity()}</div>
                            <div role="radiogroup" aria-labelledby="defect-search-severity" className="flex flex-wrap gap-1.5">
                                {categories.map((c) => (
                                    <button key={c.id} type="button" role="radio" aria-checked={props.customCategory === c.id} onClick={() => props.onCustomCategoryChange(c.id)}
                                        className={`flex-auto min-h-13 px-3 rounded-md text-[16px] flex items-center justify-center gap-1.5 ${props.customCategory === c.id ? "bg-ih-primary text-ih-primary-fg font-extrabold" : "border border-ih-border-strong text-ih-fg-2 font-bold"}`}>
                                        {c.id === "safety" && <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3.5v5.5c0 4.5-3.2 8-7 9-3.8-1-7-4.5-7-9V6.5z" /></svg>}{c.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {props.showSaveToLibrary && (
                            <label className="min-h-14 flex items-center gap-3 px-3.5 rounded-lg bg-ih-bg-card border border-ih-border">
                                <input type="checkbox" checked={props.saveToLibrary} onChange={(e) => props.onSaveToLibraryChange(e.target.checked)} className="w-6 h-6 flex-none accent-ih-primary" />
                                <span className="flex flex-col gap-0.5">
                                    <span className="text-[17px] font-semibold">{m.editor_customdefect_save_to_library()}</span>
                                    <span className="text-[14px] text-ih-fg-3">{m.editor_defectsearch_save_hint()}</span>
                                </span>
                            </label>
                        )}
                    </main>
                    <nav aria-label={m.editor_defectsearch_write_title()} className={bar}>
                        <button type="button" onClick={() => setWriting(false)} className="h-13 px-4.5 rounded-md border border-ih-border-strong text-[17px] font-bold text-ih-fg-2">{m.editor_defectsearch_back()}</button>
                        <span className="flex-1" />
                        <button type="button" disabled={!props.customTitle.trim()} onClick={() => { props.onSubmitCustomDefect(); close(); }}
                            className="h-13 px-4.5 rounded-md bg-ih-primary text-ih-primary-fg text-[18px] font-extrabold disabled:opacity-50">{m.editor_defectsearch_add_to_item()}</button>
                    </nav>
                </>
            ) : (
                <>
                    <div className="flex-none px-4 pt-3 pb-2">
                        <label className="h-13 flex items-center gap-2.5 pl-3.5 pr-1.5 rounded-lg border border-ih-primary bg-ih-bg-app text-ih-fg-3">
                            <Icon name="search" size={20} />
                            <input type="text" inputMode="search" enterKeyHint="search" autoFocus value={props.defectQuery} onChange={(e) => props.onDefectQueryChange(e.target.value)} placeholder={m.editor_canned_search_aria()} aria-label={m.editor_canned_search_aria()}
                                className="flex-1 min-w-0 h-12 bg-transparent outline-none text-[17px] text-ih-fg-1 placeholder:text-ih-fg-4" />
                            {q && <button type="button" onClick={() => props.onDefectQueryChange("")} aria-label={m.editor_defectsearch_clear()} className="w-11 h-11 flex items-center justify-center rounded-md text-ih-fg-2"><Icon name="x" size={20} /></button>}
                        </label>
                    </div>
                    <main className="flex-1 overflow-y-auto px-4 pb-22">
                        {props.currentTabEntries.length > 0 && (
                            <Group label={m.editor_defectsearch_this_item()}>
                                {props.currentTabEntries.map((d) => {
                                    const on = props.includedSet.has(d.id);
                                    // The per-inspection severity override (a tenant category id) wins over the template's, as on S05.
                                    const override = props.defectStates?.get(d.id)?.category;
                                    const cat = (override && props.customCategories?.find((c) => c.id === override)?.name) || ("category" in d ? d.category : "");
                                    return (
                                        <Row key={d.id} name={d.title} sub={htmlToPlainText(d.comment)} tag={cat ? <DefectCategoryChip category={cat} color={props.categoryColor?.get(cat)} /> : null}>
                                            <button type="button" aria-pressed={on} aria-label={on ? m.editor_defectsearch_remove_aria({ name: d.title }) : m.editor_defectsearch_add_aria({ name: d.title })}
                                                onClick={() => props.onToggleCanned?.("defects", d.id, !on)} className={addBtn(on)}>{on ? m.editor_defectsearch_added() : m.editor_defectsearch_add()}</button>
                                        </Row>
                                    );
                                })}
                            </Group>
                        )}
                        {/* A library hit is language, not a finished defect: Add opens the write form seeded with it (same as desktop). */}
                        {props.libraryMatches.length > 0 && (
                            <Group label={m.editor_canned_from_library()}>
                                {props.libraryMatches.map((lm, i) => {
                                    const name = deriveDefectTitle(lm.text);
                                    return (
                                        <Row key={lm.id ?? `lib-${i}`} name={name} sub={lm.text} tag={<span className="text-[14px] font-bold text-ih-fg-3">{lm.severity !== "all" ? lm.severity : m.editor_canned_any_severity()}{lm.section ? ` · ${lm.section}` : ""}</span>}>
                                            <button type="button" aria-label={m.editor_defectsearch_add_aria({ name })} onClick={() => { props.onSeedFromLibrary(lm); setWriting(true); }} className={addBtn(false)}>{m.editor_defectsearch_add()}</button>
                                        </Row>
                                    );
                                })}
                            </Group>
                        )}
                        {q && props.currentTabEntries.length === 0 && props.libraryMatches.length === 0 && (
                            <p className="mt-4 mx-1 text-[16px] text-ih-fg-3">{m.editor_defectsearch_empty()}</p>
                        )}
                        {props.onAddCustomDefect && (
                            <button type="button" onClick={() => { props.onCustomTitleChange(q ? q.charAt(0).toUpperCase() + q.slice(1) : ""); setWriting(true); }}
                                className="mt-3 w-full min-h-14 px-3.5 py-2 flex items-center gap-3 rounded-lg border border-dashed border-ih-border-strong text-left">
                                <Icon name="edit" size={22} />
                                <span className="flex-1 text-[17px] font-bold">{q ? m.editor_defectsearch_write_own_query({ query: q }) : m.editor_defectsearch_write_own()}</span>
                            </button>
                        )}
                    </main>
                    <nav aria-label={m.editor_defectsearch_actions()} className={bar}>
                        <span aria-live="polite" className="flex-1 text-[16px] text-ih-fg-3">{count === 1 ? m.editor_defectsearch_count_one() : m.editor_defectsearch_count_other({ count })}</span>
                        <button type="button" onClick={close} className="h-13 px-5.5 flex items-center gap-2 rounded-md bg-ih-primary text-ih-primary-fg text-[18px] font-extrabold">
                            <Icon name="checkMini" size={22} />{m.common_done()}
                        </button>
                    </nav>
                </>
            )}
        </div>
    );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <section>
            <h3 className="mt-3 mb-2 mx-1 text-[14px] font-bold uppercase tracking-[0.08em] text-ih-fg-3">{label}</h3>
            <ul className="rounded-lg overflow-hidden bg-ih-bg-card border border-ih-border divide-y divide-ih-border">{children}</ul>
        </section>
    );
}

function Row({ name, sub, tag, children }: { name: string; sub: string; tag: React.ReactNode; children: React.ReactNode }) {
    return (
        <li className="min-h-21 flex items-center gap-3 py-2.5 pr-2.5 pl-3.5">
            <span className="flex-1 min-w-0 flex flex-col items-start gap-1">
                <span className="text-[17px] font-bold">{name}</span>
                <span className="w-full text-[15px] text-ih-fg-3 truncate">{sub}</span>
                {tag}
            </span>
            {children}
        </li>
    );
}
