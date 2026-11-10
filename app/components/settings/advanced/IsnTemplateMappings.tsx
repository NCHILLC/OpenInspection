import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import type { action, loader } from "~/routes/resources/isn-mappings";
import { m } from "~/paraglide/messages";

type Data = Extract<Awaited<ReturnType<typeof loader>>, { ok: true }>['data'];

function MappingRow({ type, templates }: { type: Data['orderTypes'][number]; templates: Data['templates'] }) {
    const [templateId, setTemplateId] = useState(type.templateId ?? "");
    const save = useGuardedSubmit<typeof action>();
    useEffect(() => { setTemplateId(type.templateId ?? ""); }, [type.templateId]);
    return (
        <div className="space-y-2 border-t border-ih-border pt-3">
            <label className="block text-[13px] font-semibold text-ih-fg-1" htmlFor={`isn-template-${type.id}`}>{type.name}</label>
            <div className="flex flex-wrap gap-2">
                <select id={`isn-template-${type.id}`} value={templateId} onChange={(event) => setTemplateId(event.target.value)}
                    disabled={save.busy} className="min-h-11 min-w-0 flex-1 rounded-md border border-ih-border bg-ih-bg-card px-3 text-[13px] text-ih-fg-1">
                    <option value="">{m.settings_isn_mapping_default()}</option>
                    {type.unavailable && type.templateId && <option value={type.templateId} disabled>{m.settings_isn_mapping_unavailable()}</option>}
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
                <button type="button" disabled={save.busy || templateId === (type.templateId ?? "")}
                    onClick={() => save.submit({ orderTypeId: type.id, templateId }, { method: "post", action: "/resources/isn-mappings" })}
                    className="min-h-11 rounded-md border border-ih-border px-4 text-[13px] font-semibold text-ih-fg-1 disabled:opacity-60">
                    {save.busy ? m.common_saving() : m.common_save()}
                </button>
            </div>
            {type.unavailable && <p className="text-[13px] text-ih-bad-fg">{m.settings_isn_mapping_unavailable_help()}</p>}
            {!save.busy && save.fetcher.data && <p role="status" className={`text-[13px] ${save.fetcher.data.ok ? "text-ih-ok-fg" : "text-ih-bad-fg"}`}>
                {save.fetcher.data.ok ? m.settings_isn_mapping_saved() : save.fetcher.data.error}
            </p>}
        </div>
    );
}

export function IsnTemplateMappings() {
    const fetcher = useFetcher<typeof loader>();
    useEffect(() => { fetcher.load("/resources/isn-mappings"); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load on mount, then router revalidation
    const result = fetcher.data;
    return (
        <section className="space-y-3 max-w-xl pt-4 border-t border-ih-border" aria-label={m.settings_isn_mapping_heading()}>
            <h4 className="text-[13px] font-semibold text-ih-fg-1">{m.settings_isn_mapping_heading()}</h4>
            <p className="text-[13px] text-ih-fg-3">{m.settings_isn_mapping_help()}</p>
            {!result && <p role="status" className="text-[13px] text-ih-fg-3">{m.common_loading()}</p>}
            {result?.ok && result.data.orderTypes.map((type) => <MappingRow key={type.id} type={type} templates={result.data.templates} />)}
            {result?.ok && result.data.orderTypes.length === 0 && <p className="text-[13px] text-ih-fg-3">{m.settings_isn_mapping_empty()}</p>}
            {result && !result.ok && <div role="status" className="space-y-2 text-[13px] text-ih-bad-fg">
                <p>{result.error}</p>
                <button type="button" onClick={() => fetcher.load("/resources/isn-mappings")} disabled={fetcher.state !== "idle"}
                    className="min-h-11 rounded-md border border-ih-border px-3 font-semibold text-ih-fg-1 disabled:opacity-60">{m.settings_isn_mapping_retry()}</button>
            </div>}
        </section>
    );
}
