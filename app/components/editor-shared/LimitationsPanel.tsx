import { useState } from "react";
import { Button, Input } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { STANDARD_LIMITATION_IDS, type StandardLimitationId, type CustomLimitation } from "../../lib/limitations";

/** The chip's stored label. Resolved here, at the point of use, so a tapped
 *  reason reads in the language the inspector would have typed. */
function reasonLabel(id: StandardLimitationId): string {
    switch (id) {
        case "no_access": return m.editor_limitation_reason_no_access();
        case "locked": return m.editor_limitation_reason_locked();
        case "not_in_service": return m.editor_limitation_reason_not_in_service();
        case "weather": return m.editor_limitation_reason_weather();
        case "belongings": return m.editor_limitation_reason_belongings();
        case "unsafe": return m.editor_limitation_reason_unsafe();
    }
}

export interface LimitationsPanelProps {
    /** Limitations the inspector has already recorded on this item. */
    entries: ReadonlyArray<CustomLimitation>;
    onAdd: (title: string) => void;
    onToggle: (id: string, included: boolean) => void;
    /** True when the item is Not Inspected and a reason is therefore required. */
    required?: boolean;
}

/**
 * Where an inspector says WHY an item was not inspected.
 *
 * Two ways in, because neither alone is enough. The chips cover the reasons
 * that are the answer most of the time and want to be one tap on a phone; the
 * text box covers the seventh reason, which there always is. Both produce the
 * same custom-limitation entry, so the report reads one kind of thing and a
 * tapped reason can be edited afterwards exactly like a typed one.
 *
 * The reasons are NOT template content: no seeded template ships a single
 * limitation entry, and a locked door reads the same over an attic as over a
 * crawlspace — see `lib/limitations`.
 */
export function LimitationsPanel({ entries, onAdd, onToggle, required = false }: LimitationsPanelProps) {
    const [draft, setDraft] = useState("");
    const recorded = entries.filter((e) => e.included !== false);

    const submit = () => {
        const t = draft.trim();
        if (!t) return;
        onAdd(t);
        setDraft("");
    };

    return (
        <div className="flex flex-col gap-3" data-testid="limitations-panel">
            {required && recorded.length === 0 && (
                <p
                    data-testid="limitation-required"
                    className="text-[13px] text-ih-bad-fg bg-ih-bad-bg rounded-lg px-3 py-2"
                >
                    {m.editor_limitation_required_notice()}
                </p>
            )}

            {entries.map((e) => (
                <label key={e.id} className="flex items-start gap-2 text-[13px] text-ih-fg-1">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={e.included !== false}
                        onChange={(ev) => onToggle(e.id, ev.target.checked)}
                    />
                    <span>
                        {e.title}
                        {e.comment ? <span className="block text-ih-fg-3">{e.comment}</span> : null}
                    </span>
                </label>
            ))}

            <div className="flex flex-wrap gap-2">
                {STANDARD_LIMITATION_IDS.map((id) => (
                    <Button
                        key={id}
                        variant="ghost"
                        size="sm"
                        // A tapped reason becomes an ordinary recorded limitation;
                        // tapping two is how an inspector records two.
                        onClick={() => onAdd(reasonLabel(id))}
                        className="border border-dashed border-ih-border-strong"
                    >
                        {reasonLabel(id)}
                    </Button>
                ))}
            </div>

            <div className="flex gap-2">
                <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            submit();
                        }
                    }}
                    placeholder={m.editor_limitation_placeholder()}
                    aria-label={m.editor_limitation_aria()}
                    className="flex-1"
                />
                <Button variant="secondary" size="sm" onClick={submit} disabled={!draft.trim()}>
                    {m.editor_limitation_add()}
                </Button>
            </div>
        </div>
    );
}
