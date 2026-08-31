import { m } from "~/paraglide/messages";

export interface FindingsIndicatorProps {
    /** Whether this item carries a finding — see `hasIncludedFindings`. */
    active: boolean;
    /**
     * Activating `F`. When omitted the tile is inert (the template preview,
     * where there is nothing to open and no rating to set).
     */
    onActivate?: () => void;
    className?: string;
}

/**
 * The `F` of IN / NI / NP / F: does this item have anything wrong with it.
 *
 * ⚠️ IT SITS BESIDE THE RATING CONTROL, NOT INSIDE IT, AND THAT IS THE WHOLE
 * POINT. IN and F light on the same row simultaneously because they answer
 * different questions: the rating is what the inspector DID with the item
 * (inspected / not inspected / not present — one answer), and this is whether
 * anything is wrong with it.
 *
 * F IS NOT A RATING LEVEL AND MUST NEVER BECOME ONE. `ItemEntry.rating` holds a
 * single scalar and `RatingSegment` is a `role="radiogroup"`, so an
 * `IN/NI/NP/F` preset would make choosing F silently CLEAR IN — the report
 * would then disagree with what the inspector saw, with nothing to catch it.
 * `findings-not-a-rating-level.test.ts` holds that line.
 *
 * WHAT IT LOOKS LIKE IS A FOURTH BUTTON, AND THAT IS INTENDED. `onActivate`
 * makes the tile a real control without making it a rating value: the LIT state
 * stays derived from the included defects underneath (the only way to clear F is
 * still to un-include them), while pressing it takes the inspector to those
 * defects and asserts the inspection that a finding implies. So the row behaves
 * the way an inspector reads it while the stored answer stays coherent.
 *
 * With no `onActivate` it renders as `output` — a live region reporting a
 * derived value, which is exactly what it is when nothing can be done with it.
 */
export function FindingsIndicator({ active, onActivate, className = "" }: FindingsIndicatorProps) {
    const label = active ? m.editor_findings_present() : m.editor_findings_none();
    // Matches RatingSegment's `md` tile geometry (h-11 = the 44px touch floor)
    // so it reads as part of the same row.
    const shape =
        `inline-flex items-center justify-center h-11 min-w-11 px-3 rounded-lg ` +
        `text-[13px] font-bold select-none transition-colors ` +
        (active
            ? "bg-ih-bad text-ih-fg-inverse"
            : "bg-transparent text-ih-fg-3 border border-ih-border") +
        (className ? ` ${className}` : "");

    if (!onActivate) {
        return (
            <output
                data-testid="findings-indicator"
                data-active={active}
                aria-label={label}
                title={label}
                // cursor-default and no hover state say it is not a control.
                className={`${shape} cursor-default`}
            >
                {m.editor_findings_abbrev()}
            </output>
        );
    }

    return (
        <button
            type="button"
            data-testid="findings-indicator"
            data-active={active}
            // NOT aria-pressed: this does not toggle. Pressing it opens the
            // defects; the state goes out only when the last one is removed, so
            // announcing it as a toggle would promise something it cannot do.
            aria-label={label}
            title={label}
            onClick={onActivate}
            className={`${shape} cursor-pointer hover:opacity-90`}
        >
            {m.editor_findings_abbrev()}
        </button>
    );
}
