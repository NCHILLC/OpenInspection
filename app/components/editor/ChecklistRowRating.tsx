import type { ReactNode } from "react";
import { RatingButtonRow } from "./RatingButtonRow";
import { findRatingLevel, type EditorRatingLevel } from "~/lib/rating-levels";
import type { CollabFindingsApi } from "~/lib/collab/collab-findings-api";
import { haptic, HAPTIC_TAP } from "~/lib/haptics";
import { pushToast } from "~/hooks/useToast";
import { m } from "~/paraglide/messages";

/**
 * The phone checklist's inline rating: each row rates without opening the
 * item, the first unrated row says "Up next", and every tap can be undone.
 *
 * Returns the row footer `ItemList` renders under each row. Ratings come from
 * the template's own levels, never a hard-coded IN/NI/NP: Speed Mode shipped
 * exactly that bug (B-18).
 *
 * The undo is a toast, not a confirm: a rating is one tap to redo, and asking
 * first would double the taps on the screen whose whole point is fewer.
 */
export function checklistRowRating(
    sectionId: string,
    items: ReadonlyArray<{ id: string; label: string }>,
    levels: EditorRatingLevel[],
    findings: Pick<CollabFindingsApi, "getResult" | "setRating">,
): (itemId: string) => ReactNode {
    const ratingOf = (itemId: string) => (findings.getResult(itemId, sectionId).rating as string | undefined) || null;
    const upNextId = items.find((i) => !ratingOf(i.id))?.id;

    const rate = (itemId: string, rating: string) => {
        const prior = ratingOf(itemId);
        if (prior === rating) return;
        haptic(HAPTIC_TAP);
        findings.setRating(sectionId, itemId, rating);
        const label = findRatingLevel(levels, rating)?.label ?? rating;
        pushToast({
            message: prior ? m.editor_speedmode_undo_changed({ rating: label }) : m.editor_speedmode_undo_rated({ rating: label }),
            actionLabel: m.common_undo(),
            durationMs: 4000,
            onAction: () => findings.setRating(sectionId, itemId, prior),
        });
    };

    return (itemId) => {
        const item = items.find((i) => i.id === itemId);
        return (
            <div className="flex items-center gap-2 px-3 pb-2">
                {itemId === upNextId && (
                    <span className="shrink-0 rounded px-1.5 py-0.5 bg-ih-primary-tint text-[13px] font-semibold text-ih-primary-text">
                        {m.editor_mobile_up_next()}
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    <RatingButtonRow
                        levels={levels}
                        activeLevel={findRatingLevel(levels, ratingOf(itemId))}
                        onRating={(r) => rate(itemId, r)}
                        ariaLabel={m.editor_mobile_rate_item({ label: item?.label ?? "" })}
                    />
                </div>
            </div>
        );
    };
}
