import { useEffect, useRef, useState } from "react";
import { Icon } from "@core/shared-ui";
import type { PublishBlockingDefect, PublishReadiness } from "../../lib/types";
import { DEFECT_TRADE_OPTIONS, type DefectTrade } from "../../lib/defect-fields";
import { STANDARD_LOCATION_IDS } from "../../lib/defect-locations";
import { listPendingMedia } from "~/lib/collab/media-pending-store";
import { INSPECTION_STATUS } from "~/lib/status";
import { locationLabel } from "./DefectFieldsRow";
import type { IsnSync, PublishExtras } from "./PublishModal";
import { m } from "~/paraglide/messages";

export type GapFill = { location?: string; trade?: DefectTrade };

export interface PhoneFinishScreenProps {
    open: boolean;
    onClose: () => void;
    inspectionId: string;
    address: string;
    rated: number;
    total: number;
    findings: number;
    status: string;
    isAmendment: boolean;
    autoSign: boolean;
    onAutoSignToggle: (checked: boolean) => void;
    publishError: string | null;
    isSubmitting: boolean;
    /** `ok` on the last publish response; read when a publish from this screen settles. */
    publishOk: boolean;
    onPublish: (markComplete: boolean, extras: PublishExtras) => void;
    /** Null once the fieldwork is complete: the "publish later" choice then has nothing to do. */
    onFinishFieldwork: (() => void) | null;
    finishingFieldwork: boolean;
    /** Writes a missing defect field, the same write the defect row makes. */
    onFill: (b: PublishBlockingDefect, patch: GapFill) => void;
    /** Opens the item holding the defect. */
    onOpen: (b: PublishBlockingDefect) => void;
    /** Opens the inspection details form, where the missing temperature and weather are recorded. */
    onOpenDetails?: () => void;
    isnSync?: IsnSync | null;
    onIsnRetry?: () => void;
    isnRetrying?: boolean;
}

const card = "p-3 rounded-lg border";
const chip = (on: boolean) =>
    `h-12 px-3 rounded-md border text-[16px] ${on ? "bg-ih-primary-tint border-ih-primary text-ih-primary-text font-bold" : "border-ih-border-strong text-ih-fg-2 font-semibold"}`;
const warnIcon = <svg className="w-5 h-5 flex-none" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>;

/**
 * Canvas S10: on the phone, Publish in More opens this full screen instead of
 * the desktop's readiness modal + publish dialog. The gate is the server's own
 * (`/resources/publish-readiness`, the check the desktop runs), and a missing
 * location or trade is filled here with the defect row's write. A filled gap is
 * marked locally: the server re-checks on publish, and its refusal shows below.
 */
export function PhoneFinishScreen(p: PhoneFinishScreenProps) {
    const [readiness, setReadiness] = useState<PublishReadiness | null>(null);
    const [pending, setPending] = useState(0);
    const [fills, setFills] = useState<Record<string, GapFill>>({});
    const [mode, setMode] = useState<"now" | "later">("now");
    const [summary, setSummary] = useState("");
    const [done, setDone] = useState<"now" | "later" | null>(null);
    const [laterAsked, setLaterAsked] = useState(false);
    const publishSeen = useRef(false);
    const completed = p.status === INSPECTION_STATUS.COMPLETED;

    useEffect(() => {
        if (!p.open) return;
        setReadiness(null); setFills({}); setDone(null); setMode("now"); setLaterAsked(false);
        void listPendingMedia(p.inspectionId).then((rows) => setPending(rows.length));
        // Same BFF route the desktop pre-flight reads. A failed check does not block, as there.
        fetch(`/resources/publish-readiness?id=${encodeURIComponent(p.inspectionId)}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() as Promise<{ readiness: PublishReadiness | null }> : null))
            .then((body) => setReadiness(body?.readiness ?? { ready: true, blockingDefects: [], warningDefects: [], missingFacts: [] }))
            .catch(() => setReadiness({ ready: true, blockingDefects: [], warningDefects: [], missingFacts: [] }));
    }, [p.open, p.inspectionId]);

    // Done = a publish from here settled with ok, or the status became completed after "later".
    useEffect(() => {
        if (p.isSubmitting) { publishSeen.current = true; return; }
        if (!publishSeen.current) return;
        publishSeen.current = false;
        if (p.publishOk) { setDone("now"); setSummary(""); }
    }, [p.isSubmitting, p.publishOk]);
    // The route patches the status only when the complete request succeeded.
    useEffect(() => { if (laterAsked && completed) setDone("later"); }, [laterAsked, completed]);

    if (!p.open) return null;

    const key = (b: PublishBlockingDefect) => `${b.itemId}:${b.cannedId}`;
    // Only location can be required (the policy collapses trade out); a {{token}}
    // in the text always blocks, so {{trade}} is the one way trade is needed.
    const needs = (b: PublishBlockingDefect) => [...new Set([...(b.missing.includes("location") ? ["location"] : []), ...b.unresolvedTokens])];
    const open = (readiness?.blockingDefects ?? []).filter((b) => needs(b).some((n) => !(fills[key(b)] ?? {})[n as keyof GapFill]));
    const warnings = readiness?.warningDefects?.length ?? 0;
    const facts = readiness?.missingFacts ?? [];
    const laterMode = mode === "later" && !!p.onFinishFieldwork;
    const blocked = !laterMode && (readiness === null || open.length > 0 || facts.length > 0);
    const fill = (b: PublishBlockingDefect, patch: GapFill) => {
        setFills((f) => ({ ...f, [key(b)]: { ...f[key(b)], ...patch } }));
        p.onFill(b, patch);
    };
    const go = () => {
        if (blocked) return;
        if (laterMode) { p.onFinishFieldwork?.(); setLaterAsked(true); return; }
        p.onPublish(!completed, p.isAmendment && summary.trim() ? { summary: summary.trim() } : {});
    };
    const busy = p.isSubmitting || p.finishingFieldwork;

    return (
        <div role="dialog" aria-modal="true" aria-label={m.editor_finish_title()} className="fixed inset-0 z-50 flex flex-col bg-ih-bg-app text-ih-fg-1">
            <header className="h-16 flex-none flex items-center gap-1 px-1 border-b border-ih-border">
                <button type="button" onClick={p.onClose} aria-label={m.common_close()} className="w-12 h-12 flex items-center justify-center rounded-md text-ih-fg-2"><Icon name="back" size={24} /></button>
                <div className="flex-1 min-w-0 pl-1">
                    <div className="text-[14px] font-semibold uppercase tracking-[0.08em] text-ih-fg-3 truncate">{p.address}</div>
                    <h2 className="text-[22px] leading-tight font-bold">{done === "now" ? m.report_publish_receipt_title() : done === "later" ? m.editor_finish_done_later_title() : m.editor_finish_title()}</h2>
                </div>
            </header>

            {done ? (
                <main className="flex-1 overflow-y-auto px-6 py-12 flex flex-col items-center text-center gap-4">
                    <span className="w-18 h-18 rounded-full bg-ih-ok text-ih-fg-inverse flex items-center justify-center"><Icon name="check" size={36} /></span>
                    <p className="text-[17px] text-ih-fg-2 max-w-80">{done === "now" ? m.report_publish_receipt_nothing_sent() : m.editor_finish_done_later_body()}</p>
                    {done === "now" && <p className="text-[15px] text-ih-fg-3 max-w-80">{m.report_publish_body_delivery()}</p>}
                    {done === "now" && p.isnSync && (
                        <section aria-live="polite" className={`${card} w-full text-left text-[16px] flex flex-col gap-3 ${p.isnSync.ok ? "bg-ih-ok-bg border-ih-ok/30 text-ih-ok-fg" : "bg-ih-bad-bg border-ih-bad/30 text-ih-bad-fg"}`}>
                            <span>{p.isnRetrying ? m.report_publish_checking() : p.isnSync.ok ? m.report_publish_receipt_isn_ok() : m.report_publish_receipt_isn_failed({ error: p.isnSync.error ?? "" })}</span>
                            {!p.isnSync.ok && p.onIsnRetry && (
                                <button type="button" disabled={p.isnRetrying} onClick={p.onIsnRetry} className="self-start h-12 px-4 rounded-md border border-ih-border-strong text-[16px] font-bold text-ih-fg-1">{m.report_publish_receipt_isn_retry()}</button>
                            )}
                        </section>
                    )}
                    <a href="/inspections" className="mt-3 h-14 px-6 flex items-center rounded-md bg-ih-primary text-ih-primary-fg text-[18px] font-extrabold">{m.editor_mobile_back_to_inspections()}</a>
                </main>
            ) : (
                <>
                    <main className="flex-1 overflow-y-auto px-4 pt-3 pb-28 flex flex-col gap-3">
                        <section className={`${card} bg-ih-bg-card border-ih-border-strong flex flex-col gap-1.5`}>
                            <div className="text-[18px] font-bold">
                                {m.editor_finish_rated({ rated: p.rated, total: p.total })} · <span className="text-ih-bad-fg">{m.editor_shared_section_findings({ count: p.findings, s: p.findings === 1 ? "" : "s" })}</span>
                            </div>
                            <div className={`text-[15px] flex items-center gap-1.5 ${pending ? "text-ih-watch-fg" : "text-ih-ok-fg"}`}>
                                <span aria-hidden className={`w-2 h-2 rounded-full ${pending ? "bg-ih-watch" : "bg-ih-ok"}`} />
                                {pending ? m.editor_finish_photos_waiting({ count: pending, s: pending === 1 ? "" : "s" }) : m.editor_finish_photos_uploaded()}
                            </div>
                        </section>

                        {readiness !== null && facts.length > 0 && (
                            <section aria-label={m.editor_gate_facts_open()} data-testid="finish-missing-facts" className={`${card} bg-ih-bad-bg border-ih-bad/30 flex items-center gap-2`}>
                                <span className="flex-1 min-w-0 flex items-center gap-2 text-ih-bad-fg text-[17px] font-bold">{warnIcon}{facts.length === 2 ? m.editor_gate_facts_both() : facts[0] === "temperature" ? m.editor_gate_facts_temperature() : m.editor_gate_facts_weather()}</span>
                                {p.onOpenDetails && (
                                    <button type="button" onClick={p.onOpenDetails} className="h-12 px-2.5 text-[15px] font-bold text-ih-primary-text">{m.editor_gate_facts_open()}</button>
                                )}
                            </section>
                        )}
                        {readiness === null ? (
                            <p className="text-[16px] text-ih-fg-3">{m.report_publish_checking()}</p>
                        ) : open.length > 0 ? (
                            <section aria-label={m.editor_finish_needed()} className={`${card} bg-ih-bad-bg border-ih-bad/30 flex flex-col gap-4`}>
                                <div className="flex items-center gap-2 text-ih-bad-fg text-[17px] font-bold">{warnIcon}{open.length === 1 ? m.editor_finish_needed_one() : m.editor_finish_needed_other({ count: open.length })}</div>
                                {open.map((b) => {
                                    const f = fills[key(b)] ?? {};
                                    const need = needs(b);
                                    const tokens = need.filter((t) => t !== "location" && t !== "trade");
                                    return (
                                        <div key={key(b)} className="flex flex-col gap-2">
                                            <div className="flex items-start gap-2">
                                                <span className="flex-1 min-w-0 flex flex-col">
                                                    <span className="text-[14px] text-ih-fg-3">{b.sectionTitle} › {b.itemLabel}</span>
                                                    <span className="text-[17px] font-bold">{b.cannedTitle}</span>
                                                </span>
                                                <button type="button" onClick={() => p.onOpen(b)} aria-label={m.editor_finish_open_aria({ name: b.cannedTitle })} className="h-12 px-2.5 text-[15px] font-bold text-ih-primary-text">{m.editor_finish_open()}</button>
                                            </div>
                                            {need.includes("location") && (
                                                <div role="radiogroup" aria-label={m.editor_defect_location_label()} className="flex flex-col gap-1.5">
                                                    <span className="text-[14px] font-bold uppercase tracking-[0.06em] text-ih-fg-3">{m.editor_defect_location_label()}</span>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {STANDARD_LOCATION_IDS.map((id) => {
                                                            const label = locationLabel(id);
                                                            return <button key={id} type="button" role="radio" aria-checked={f.location === label} onClick={() => fill(b, { location: label })} className={chip(f.location === label)}>{label}</button>;
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {need.includes("trade") && (
                                                <div role="radiogroup" aria-label={m.editor_finish_trade()} className="flex flex-col gap-1.5">
                                                    <span className="text-[14px] font-bold uppercase tracking-[0.06em] text-ih-fg-3">{m.editor_finish_trade()}</span>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {DEFECT_TRADE_OPTIONS.map((o) => (
                                                            <button key={o.value} type="button" role="radio" aria-checked={f.trade === o.value} onClick={() => fill(b, { trade: o.value })} className={chip(f.trade === o.value)}>{o.label}</button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {tokens.length > 0 && <p className="text-[15px] text-ih-fg-2">{m.editor_finish_tokens({ tokens: tokens.map((t) => `{{${t}}}`).join(", ") })}</p>}
                                        </div>
                                    );
                                })}
                            </section>
                        ) : facts.length === 0 ? (
                            <section className={`${card} bg-ih-ok-bg border-ih-ok/30 flex items-center gap-2 text-ih-ok-fg text-[17px] font-bold`}><Icon name="check" size={20} />{m.editor_finish_all_filled()}</section>
                        ) : null}

                        {warnings > 0 && (
                            <div className={`${card} bg-ih-watch-bg border-ih-watch/50 text-ih-watch-fg text-[15px]`}>
                                {warnings === 1 ? m.editor_finish_warnings_one() : m.editor_finish_warnings_other({ count: warnings })}
                            </div>
                        )}

                        <div role="radiogroup" aria-label={m.editor_finish_how()} className="flex flex-col gap-2">
                            {([["now", m.editor_publish_now(), m.report_publish_body_finalize()], ...(p.onFinishFieldwork ? [["later", m.editor_finish_later(), m.editor_finish_later_sub()]] : [])] as Array<["now" | "later", string, string]>).map(([id, title, sub]) => (
                                <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}
                                    className={`${card} min-h-19 flex items-start gap-3 text-left ${mode === id ? "bg-ih-primary-tint border-ih-primary" : "bg-ih-bg-card border-ih-border-strong"}`}>
                                    <span aria-hidden className={`mt-0.5 w-6 h-6 flex-none rounded-full border-2 flex items-center justify-center ${mode === id ? "border-ih-primary bg-ih-primary" : "border-ih-border-strong"}`}>
                                        {mode === id && <span className="w-2.5 h-2.5 rounded-full bg-ih-primary-fg" />}
                                    </span>
                                    <span className="flex-1 flex flex-col gap-0.5"><span className="text-[18px] font-bold">{title}</span><span className="text-[15px] text-ih-fg-3">{sub}</span></span>
                                </button>
                            ))}
                        </div>

                        {!laterMode && p.isAmendment && (
                            <label className="block">
                                <span className="block text-[15px] font-medium text-ih-fg-2 mb-1">{m.inspections_hub_publish_summary_label()}</span>
                                <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} maxLength={500} placeholder={m.inspections_hub_publish_summary_ph()}
                                    className="w-full rounded-lg border border-ih-border-strong bg-ih-bg-card px-3 py-2 text-[17px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:border-ih-primary" />
                            </label>
                        )}
                        {!laterMode && (
                            <label className="min-h-12 inline-flex items-center gap-3 text-[16px] text-ih-fg-2">
                                <input type="checkbox" checked={p.autoSign} onChange={(e) => p.onAutoSignToggle(e.target.checked)} className="w-5 h-5 rounded border-ih-border-strong text-ih-primary" />
                                {m.editor_publish_autosign()}
                            </label>
                        )}
                        {p.publishError && <div role="alert" className={`${card} bg-ih-bad-bg border-ih-bad/30 text-[15px] text-ih-bad-fg font-medium`}>{p.publishError}</div>}
                    </main>

                    <nav aria-label={m.editor_finish_title()} className="fixed inset-x-0 bottom-0 h-22 flex items-center px-3 bg-ih-bg-card border-t border-ih-border">
                        <button type="button" onClick={go} aria-disabled={blocked || busy} disabled={busy}
                            className={`w-full h-15 rounded-md flex items-center justify-center gap-2.5 text-[18px] font-extrabold ${blocked ? "bg-ih-bg-muted text-ih-fg-3" : "bg-ih-primary text-ih-primary-fg"}`}>
                            {busy ? (p.isSubmitting ? m.editor_publish_publishing() : m.editor_finish_fieldwork_pending())
                                : laterMode ? m.editor_finish_fieldwork()
                                : readiness && open.length > 0 ? m.editor_finish_fill_to_publish({ count: open.length })
                                : readiness && facts.length > 0 ? m.editor_finish_details_to_publish()
                                : m.editor_finish_publish()}
                        </button>
                    </nav>
                </>
            )}
        </div>
    );
}
