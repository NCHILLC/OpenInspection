import { useEffect, useMemo, useRef } from 'react';
import type { DefectTrade, DefectDeadline, DefectTimeframe } from '../../lib/defect-fields';
import { m } from '~/paraglide/messages';

export interface DefectFieldsValue {
    location?: string | null;
    /** Tenant `defect_categories.id` — the per-defect severity override. */
    category?: string | null;
    /** Retained in the stored shape (and in the comment template's variables)
     *  but no longer authored here — see the note on the removed controls. */
    trade?: DefectTrade | null;
    deadline?: DefectDeadline | null;
    timeframe?: DefectTimeframe | null;
}

interface DefectCategoryOption {
    id: string;
    name: string;
}

export interface DefectFieldsRowProps {
    cannedId: string;
    value: DefectFieldsValue;
    /** Prior location strings used in this inspection — drives autocomplete via <datalist>. */
    locationSuggestions: string[];
    onChange: (cannedId: string, patch: Partial<DefectFieldsValue>) => void;
    /** Marks the location input as visually required when the publish gate flagged it. */
    locationRequired?: boolean;
    /** The tenant's configured severities, in `sort_order`. The FIRST is the
     *  default applied to a defect that has never been given one. */
    categories?: DefectCategoryOption[];
    /** `defect_categories.color` by id — the selected tile is filled with it. */
    categoryColor?: Map<string, string>;
}

const DATALIST_ID = 'defect-location-suggestions';

/**
 * The per-defect fields an inspector fills in on an included defect.
 *
 * SEVERITY IS THE POINT OF THIS ROW. It writes `category`, the per-defect
 * override of the template's category, using the tenant's own configured
 * severities (Minor / Moderate / Safety-Major). Before this control existed the
 * category was fixed by the template and rendered as a read-only chip, so every
 * defect in a report carried whatever the canned library said — most of them the
 * built-in "recommendation", which is not a severity anyone chose.
 *
 * The trade / deadline / timeframe selects were REMOVED (they are not part of
 * this product's reporting), but their fields stay in `DefectFieldsValue`
 * because the stored shape and the comment template's variables still carry
 * them. They simply stay null now. Do not delete the fields to "tidy up" —
 * that is a data change wearing a cleanup's clothes.
 */
export function DefectFieldsRow({
    cannedId, value, locationSuggestions, onChange, locationRequired, categories, categoryColor,
}: DefectFieldsRowProps) {
    const dedupedSuggestions = useMemo(
        () => Array.from(new Set(locationSuggestions.filter(s => s.length > 0))),
        [locationSuggestions],
    );

    const defaultCategoryId = categories?.[0]?.id;

    // A defect that has never been given a severity takes the first configured
    // one. Persisted rather than merely displayed: a severity the inspector can
    // see on screen but that was never written would publish as the template's
    // category, and the report would disagree with the screen.
    //
    // `onChange` is deliberately NOT a dependency, and is read through a ref.
    // The editor passes a fresh inline arrow on every render, so depending on
    // its identity re-runs this effect every render — and if the write ever
    // fails to round-trip into `value.category`, that is an unbounded loop of
    // writes rather than a one-time default. The guard below must be the only
    // thing that decides whether this fires.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
        if (!value.category && defaultCategoryId) {
            onChangeRef.current(cannedId, { category: defaultCategoryId });
        }
    }, [cannedId, value.category, defaultCategoryId]);

    const selectedCategory = value.category ?? defaultCategoryId ?? null;

    return (
        <div className="mt-2 grid grid-cols-12 gap-2 text-[11px]" data-defect-id={cannedId}>
            {/* Severity */}
            {categories && categories.length > 0 && (
                <div className="col-span-12">
                    <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">
                        {m.editor_defect_severity_label()}
                    </label>
                    <div role="radiogroup" aria-label={m.editor_defect_severity_label()} className="flex gap-1.5 flex-wrap">
                        {categories.map(c => {
                            const isSelected = c.id === selectedCategory;
                            const color = categoryColor?.get(c.id);
                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    data-testid={`defect-severity-${c.id}`}
                                    // THE ROW IS A <label> (CannedCommentRow renders
                                    // as="label"), and a click on a button inside a
                                    // label is forwarded to that label's control —
                                    // here the inclusion checkbox. Without both calls
                                    // the tap toggles the defect off instead of
                                    // setting its severity, which is exactly how this
                                    // shipped unusable.
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onChange(cannedId, { category: c.id });
                                    }}
                                    // h-11 is the 44px touch floor — this row is used one-handed
                                    // on a phone, which is the surface it was built for.
                                    className={`h-11 px-3 rounded border text-[13px] font-bold transition-colors ${
                                        isSelected
                                            ? 'text-ih-fg-inverse border-transparent'
                                            : 'bg-transparent text-ih-fg-3 border-ih-border'
                                    }`}
                                    style={isSelected && color ? { backgroundColor: color } : undefined}
                                >
                                    {c.name}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Location text */}
            <div className="col-span-12">
                <label className="block font-bold uppercase tracking-[0.1em] text-ih-fg-4 mb-0.5">
                    {m.editor_defect_location_label()} {locationRequired && <span className="text-ih-bad-fg">*</span>}
                </label>
                <input
                    type="text"
                    list={DATALIST_ID}
                    value={value.location ?? ''}
                    onChange={e => onChange(cannedId, { location: e.target.value || null })}
                    placeholder={m.editor_defect_location_placeholder()}
                    className={`w-full px-2 h-11 rounded border bg-ih-bg-app text-ih-fg-1 ${
                        locationRequired && !value.location ? 'border-ih-bad' : 'border-ih-border'
                    }`}
                />
                <datalist id={DATALIST_ID}>
                    {dedupedSuggestions.map(s => <option key={s} value={s} />)}
                </datalist>
            </div>
        </div>
    );
}
