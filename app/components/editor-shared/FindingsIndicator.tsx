import { m } from "~/paraglide/messages";

export interface FindingsIndicatorProps {
    /** Whether this item carries a finding — see `hasIncludedFindings`. */
    active: boolean;
    className?: string;
}

/**
 * The `F` of IN / NI / NP / F: does this item have anything wrong with it.
 *
 * ⚠️ IT SITS BESIDE THE RATING CONTROL, NOT INSIDE IT, AND THAT IS THE WHOLE
 * POINT. Spectora lights `IN` and `F` on the same row simultaneously, so they
 * answer different questions: the rating is what the inspector DID with the
 * item (inspected / not inspected / not present — one answer), and this is
 * whether anything is wrong with it (independent of that answer).
 *
 * Putting F inside `RatingSegment` would break it twice over. Semantically,
 * `ItemEntry.rating` is one scalar, so selecting F would clear IN and the
 * report would stop matching what the inspector saw. Structurally,
 * `RatingSegment` is a `role="radiogroup"` and this is not selectable — a
 * `role="radio"` nobody can choose is a lie told to a screen reader.
 *
 * So it renders as `output`: a live region reporting a derived value, which is
 * exactly what it is. No click handler, because there is nothing to toggle —
 * the way to clear F is to un-include the findings underneath it.
 */
export function FindingsIndicator({ active, className = "" }: FindingsIndicatorProps) {
    return (
        <output
            data-testid="findings-indicator"
            data-active={active}
            aria-label={active ? m.editor_findings_present() : m.editor_findings_none()}
            title={active ? m.editor_findings_present() : m.editor_findings_none()}
            className={
                // Matches RatingSegment's `md` tile geometry (h-11 = the 44px
                // touch floor) so it reads as part of the same row, while the
                // cursor-default and missing hover state say it is not a control.
                `inline-flex items-center justify-center h-11 min-w-11 px-3 rounded-lg ` +
                `text-[13px] font-bold cursor-default select-none transition-colors ` +
                (active
                    ? "bg-ih-bad text-ih-fg-inverse"
                    : "bg-transparent text-ih-fg-3 border border-ih-border") +
                (className ? ` ${className}` : "")
            }
        >
            {m.editor_findings_abbrev()}
        </output>
    );
}
