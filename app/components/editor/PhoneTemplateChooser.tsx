import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button, Icon } from "@core/shared-ui";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import type { loader as templateLoader } from "~/routes/resources/template-search";
import { m } from "~/paraglide/messages";

const HEADING = "mx-1 mt-5 mb-2 text-[14px] font-bold uppercase tracking-[0.08em] text-ih-fg-3";

/**
 * The editor body of an inspection that has no sections yet (B-22): nothing to
 * rate until a template is applied. Phones get the chooser (canvas X4); the
 * desktop keeps its single "Choose a template" button, which opens the settings
 * sheet where the same choice is made.
 */
export function EmptyTemplate({ phone, inspection, onChoose }: { phone: boolean; inspection: Record<string, unknown>; onChoose: () => void }) {
    if (phone) return <PhoneTemplateChooser inspection={inspection} />;
    return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
            <p className="text-[15px] font-semibold text-ih-fg-1">{m.editor_route_empty_template_title()}</p>
            <p className="text-[13px] text-ih-fg-3 max-w-sm">{m.editor_route_empty_template_desc()}</p>
            <Button variant="primary" onClick={onChoose}>
                {m.editor_route_choose_template()}
            </Button>
        </div>
    );
}

/** English words a template's name uses for each property type. The list endpoint returns names only, so the name is all there is to match on. */
const NAME_TERMS: Record<string, string[]> = {
    single_family: ["single family"],
    multi_unit: ["multi unit", "multi family", "condo", "townhome", "townhouse", "duplex"],
    commercial: ["commercial"],
};

const TYPE_LABEL: Partial<Record<string, () => string>> = {
    single_family: () => m.editor_property_type_single_family(),
    multi_unit: () => m.editor_property_type_multi_unit(),
    commercial: () => m.editor_property_type_commercial(),
};

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Does this template's name say it is for the kind of property that was ordered? */
export function templateMatchesOrder(templateName: string, propertyType: string | null | undefined): boolean {
    const name = words(templateName);
    return (NAME_TERMS[propertyType ?? ""] ?? []).some((t) => name.includes(words(t)));
}

/** The "Ordered: …" line, from what the inspection row holds. Parts it lacks are left out. */
export function orderSummary(inspection: Record<string, unknown>): string[] {
    const type = TYPE_LABEL[inspection.propertyType as string]?.();
    const sqft = Number(inspection.sqft);
    const year = Number(inspection.yearBuilt);
    return [
        type ? m.editor_template_ordered({ type }) : null,
        sqft > 0 ? m.editor_template_sqft({ count: new Intl.NumberFormat().format(sqft) }) : null,
        year > 0 ? m.editor_template_built({ year }) : null,
    ].filter((p): p is NonNullable<typeof p> => p !== null);
}

function PhoneTemplateChooser({ inspection }: { inspection: Record<string, unknown> }) {
    const list = useFetcher<typeof templateLoader>();
    const { fetcher: apply, submit, busy } = useGuardedSubmit<{ ok: boolean; intent?: string }>();
    const [picked, setPicked] = useState<string | null>(null);
    useEffect(() => {
        void list.load("/resources/template-search?page=1");
        // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
    }, []);
    // Same as the settings sheet: the editor's state is frozen at mount from the
    // template, so applying one needs a full reload, not a revalidation.
    useEffect(() => {
        if (apply.state === "idle" && apply.data?.ok && apply.data.intent === "save-settings") window.location.reload();
    }, [apply.state, apply.data]);

    const templates = list.data?.templates ?? [];
    const summary = orderSummary(inspection);
    const failed = apply.state === "idle" && apply.data?.ok === false;
    const start = () => {
        if (picked) submit({ intent: "save-settings", payload: JSON.stringify({ templateId: picked }) }, { method: "post" });
    };

    return (
        <div data-testid="phone-template-chooser" className="pb-20">
            <section className="bg-ih-bg-card border border-ih-border-strong rounded-lg px-3.5 py-3 flex flex-col gap-2">
                <h2 className="flex items-center gap-2 text-[16px] font-bold text-ih-watch-fg">
                    <Icon name="alertTriangle" size={20} />{m.editor_template_none_title()}
                </h2>
                <p className="text-[16px] text-ih-fg-2">{m.editor_template_none_desc()}</p>
                {summary.length > 0 && (
                    <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-[15px] text-ih-fg-3">
                        {summary.map((part) => <span key={part}>{part}</span>)}
                    </p>
                )}
            </section>

            <h2 className={HEADING}>{m.editor_template_list_heading()}</h2>
            <div role="radiogroup" aria-label={m.editor_template_list_heading()} className="flex flex-col gap-2">
                {templates.map((t) => {
                    const on = picked === t.id;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setPicked(on ? null : t.id)}
                            className={`min-h-18 px-3.5 py-2.5 flex items-center gap-3.5 rounded-lg bg-ih-bg-card text-left ${on ? "border-2 border-ih-primary" : "border border-ih-border-strong"}`}
                        >
                            <span aria-hidden className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center border-2 ${on ? "border-ih-primary" : "border-ih-border-strong"}`}>
                                {on && <span className="w-3 h-3 rounded-full bg-ih-primary" />}
                            </span>
                            <span className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                                <span className="text-[18px] font-bold text-ih-fg-1">{t.name}</span>
                                {templateMatchesOrder(t.name, inspection.propertyType as string | null) && (
                                    <span className="h-6.5 px-2 rounded-full bg-ih-ok-bg border border-ih-ok-fg/30 text-ih-ok-fg text-[14px] font-bold flex items-center">
                                        {m.editor_template_matches()}
                                    </span>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>
            <p className="mx-1 mt-3.5 text-[15px] text-ih-fg-3">{m.editor_template_change_later()}</p>

            <nav className="fixed inset-x-0 bottom-18 z-30 h-18 flex items-center gap-2 px-3 bg-ih-bg-card border-t border-ih-border">
                <span aria-live="polite" className={`flex-1 min-w-0 truncate text-[16px] ${failed ? "text-ih-bad-fg font-bold" : "text-ih-fg-3"}`}>
                    {failed ? m.editor_settings_save_error() : busy ? m.editor_header_save_saving() : templates.find((t) => t.id === picked)?.name ?? m.editor_template_pick()}
                </span>
                <button
                    type="button"
                    onClick={start}
                    disabled={!picked || busy}
                    className="h-13 px-5 flex items-center gap-2 rounded-md bg-ih-primary text-ih-primary-fg text-[18px] font-extrabold disabled:bg-ih-bg-muted disabled:text-ih-fg-3"
                >
                    {m.editor_template_start()}
                    <Icon name="arrowR" size={22} />
                </button>
            </nav>
        </div>
    );
}
