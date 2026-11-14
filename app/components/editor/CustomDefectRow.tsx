import { useEffect, useRef, type ReactNode } from "react";
import { CannedCommentRow } from "../editor-shared/CannedCommentRow";
import { DefectLocationField } from "./DefectFieldsRow";
import { DefectCameraButton } from "./DefectRowActions";
import { DEFECT_TRADE_LABELS } from "../../lib/defect-fields";
import type { CustomDefect } from "../../lib/custom-defects";
import { m } from "~/paraglide/messages";

type Target = { kind: "canned" | "custom"; id: string };

export interface CustomDefectRowProps {
    defect: CustomDefect & { photos?: Array<{ key: string }> };
    categoryColor?: Map<string, string>;
    onToggle?: (customId: string, included: boolean) => void;
    defectPhotoChip: (target: Target, photos: Array<{ key: string }>, name?: string) => ReactNode;
    onCamera?: (target: Target, name: string) => void;
    /** Writes the defect's location. Absent → no location field (read-only surfaces). */
    onLocation?: (customId: string, location: string | null) => void;
    locationSuggestions: string[];
    /** A copy the inspector just made: scroll it into view, location field showing. */
    focusOnMount?: boolean;
}

/** A field-authored (or copied) defect: a CannedCommentRow with the "inspector-added" badge. */
export function CustomDefectRow({
    defect: cd, categoryColor, onToggle, defectPhotoChip, onCamera, onLocation, locationSuggestions, focusOnMount,
}: CustomDefectRowProps) {
    const ref = useRef<HTMLDivElement>(null);
    const included = cd.included !== false;
    useEffect(() => {
        // No focus: a text field would raise the phone keyboard over the location chips.
        if (focusOnMount) ref.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }, [focusOnMount]);
    return (
        <div ref={ref} data-custom-defect-id={cd.id}>
            <CannedCommentRow
                as="label"
                selected={included}
                title={cd.title}
                category={cd.category}
                categoryColor={categoryColor?.get(cd.category)}
                extraBadge={
                    <span className="ml-1.5 text-[12px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-ih-primary-tint text-ih-primary-text">
                        {m.editor_canned_custom_badge()}
                    </span>
                }
                leading={
                    <input
                        type="checkbox"
                        checked={included}
                        onChange={() => onToggle?.(cd.id, !included)}
                        className="mt-0.5 w-4 h-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                    />
                }
                bodySlot={
                    // IA-85 — the comment AND the trade, read-only: a custom defect's
                    // text has no edit surface yet.
                    (cd.comment || cd.trade) ? (
                        <>
                            {cd.comment && (
                                <p className="text-[15px] mt-0.5 leading-relaxed text-ih-fg-3">{cd.comment}</p>
                            )}
                            {/* fg-3, not fg-4: fg-4 measured 2.64:1 against the selected
                                row's tinted background at 11px, under the 4.5:1 AA floor.
                                `lint:contrast` cannot see a background composited at runtime. */}
                            {cd.trade && DEFECT_TRADE_LABELS[cd.trade] && (
                                <p className="text-[14px] mt-0.5 text-ih-fg-3">
                                    {m.editor_customdefect_trade_summary({ trade: DEFECT_TRADE_LABELS[cd.trade] })}
                                </p>
                            )}
                        </>
                    ) : null
                }
            >
                {/* FE-3 — photos pinned to this custom defect, plus the one-tap camera. */}
                {included && (
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                        {defectPhotoChip({ kind: "custom", id: cd.id }, Array.isArray(cd.photos) ? cd.photos : [], cd.title)}
                        {onCamera && <DefectCameraButton name={cd.title} onCamera={() => onCamera({ kind: "custom", id: cd.id }, cd.title)} />}
                    </span>
                )}
                {included && onLocation && (
                    <div className="mt-2 text-[14px]">
                        <DefectLocationField
                            location={cd.location ?? null}
                            onChange={(location) => onLocation(cd.id, location)}
                            suggestions={locationSuggestions}
                        />
                    </div>
                )}
            </CannedCommentRow>
        </div>
    );
}
