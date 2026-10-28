import { useState, type ReactNode } from "react";
import { RatingButtonRow } from "./RatingButtonRow";
import { MobileBottomDrawer } from "~/components/MobileBottomDrawer";
import { LimitationsPanel } from "../editor-shared/LimitationsPanel";
import { requiresLimitation, createCustomLimitation, type CustomLimitation } from "~/lib/limitations";
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
 *
 * A Not Inspected tap with no reason recorded opens the reason sheet (canvas
 * X2). Cancelling it leaves "NI needs a reason" on the row, so a skipped
 * reason stays in sight instead of surfacing only at publish.
 */
export function checklistRowRating(
    sectionId: string,
    items: ReadonlyArray<{ id: string; label: string }>,
    levels: EditorRatingLevel[],
    findings: Pick<CollabFindingsApi, "getResult" | "setRating" | "addCustomLimitation">,
    controls?: (itemId: string) => ReactNode,
): (itemId: string) => ReactNode {
    const ratingOf = (itemId: string) => (findings.getResult(itemId, sectionId).rating as string | undefined) || null;
    const upNextId = items.find((i) => !ratingOf(i.id))?.id;

    const reasonsOf = (itemId: string) =>
        ((findings.getResult(itemId, sectionId).customComments as { limitations?: CustomLimitation[] } | undefined)?.limitations ?? []);
    const needsReason = (itemId: string) =>
        requiresLimitation(findRatingLevel(levels, ratingOf(itemId))) && !reasonsOf(itemId).some((l) => l.included !== false);

    /** Returns true when the tap made the item need a reason. */
    const rate = (itemId: string, rating: string): boolean => {
        const prior = ratingOf(itemId);
        if (prior === rating) return false;
        haptic(HAPTIC_TAP);
        findings.setRating(sectionId, itemId, rating);
        const label = findRatingLevel(levels, rating)?.label ?? rating;
        pushToast({
            message: prior ? m.editor_speedmode_undo_changed({ rating: label }) : m.editor_speedmode_undo_rated({ rating: label }),
            actionLabel: m.common_undo(),
            durationMs: 4000,
            onAction: () => findings.setRating(sectionId, itemId, prior),
        });
        return requiresLimitation(findRatingLevel(levels, rating)) && !reasonsOf(itemId).some((l) => l.included !== false);
    };

    return (itemId) => {
        const item = items.find((i) => i.id === itemId);
        return (
            <ChecklistRow
                key={itemId}
                label={item?.label ?? ""}
                upNext={!controls && itemId === upNextId}
                controls={controls?.(itemId)}
                levels={levels}
                rating={ratingOf(itemId)}
                needsReason={needsReason(itemId)}
                onRate={(r) => rate(itemId, r)}
                onAddReason={(title) => findings.addCustomLimitation(sectionId, itemId, createCustomLimitation(title))}
            />
        );
    };
}

/** One row's footer. A component, not inline JSX, because the sheet's open
 *  state belongs to the row. */
function ChecklistRow({ label, upNext, levels, rating, needsReason, onRate, onAddReason, controls }: {
    label: string;
    upNext: boolean;
    levels: EditorRatingLevel[];
    rating: string | null;
    needsReason: boolean;
    onRate: (rating: string) => boolean;
    onAddReason: (title: string) => void;
    controls?: ReactNode;
}) {
    const [sheetOpen, setSheetOpen] = useState(false);
    return (
        <div className={controls ? "" : "pb-2"}>
            <div className={`flex items-center gap-2 ${controls ? "flex-wrap" : "px-3"}`}>
                {upNext && (
                    <span className="shrink-0 rounded px-1.5 py-0.5 bg-ih-primary-tint text-[13px] font-semibold text-ih-primary-text">
                        {m.editor_mobile_up_next()}
                    </span>
                )}
                <div className={`flex-1 ${controls ? levels.length > 3 ? "min-w-0 basis-full" : "min-w-[160px]" : "min-w-0"}`}>
                    <RatingButtonRow
                        levels={levels}
                        activeLevel={findRatingLevel(levels, rating)}
                        onRating={(r) => { if (onRate(r)) setSheetOpen(true); }}
                        ariaLabel={m.editor_mobile_rate_item({ label })}
                        wrap={!!controls}
                    />
                </div>
                {controls}
            </div>
            {needsReason && !sheetOpen && (
                <button
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    className="mt-2 mx-3 min-h-11 w-[calc(100%-1.5rem)] flex items-center gap-2 rounded-lg border border-ih-watch/40 bg-ih-watch-bg px-3 text-left text-[15px] font-bold text-ih-watch-fg"
                >
                    <span className="flex-1">{m.editor_ni_reason_needed()}</span>
                    {m.editor_ni_reason_add()}
                </button>
            )}
            {/* Mounted only while open: one sheet per row would otherwise sit
                hidden in the DOM for every item in the section. */}
            {sheetOpen && (
                <MobileBottomDrawer open onClose={() => setSheetOpen(false)} title={m.editor_ni_reason_title({ label })} heightFraction={0.6}>
                    <div className="p-4">
                        <LimitationsPanel
                            // The sheet only ADDS a reason; editing recorded ones is the item screen's job.
                            entries={[]}
                            required
                            onAdd={(title) => { onAddReason(title); setSheetOpen(false); }}
                            onToggle={() => {}}
                        />
                    </div>
                </MobileBottomDrawer>
            )}
        </div>
    );
}
