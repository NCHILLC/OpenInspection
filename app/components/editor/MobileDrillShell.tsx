import type { ReactNode } from "react";
import { m } from "~/paraglide/messages";
import { MobileAppBar } from "./MobileAppBar";
import { MobileSyncPill } from "./MobileSyncPill";
import type { EditorNavLevel } from "~/routes/inspection-edit/useEditorUrlNav";

/**
 * The sheets that survive the drill-down. `sections` and `items` used to live
 * here too; they are screens now, not drawers, which is the whole point of the
 * stack — so the union narrowed rather than keeping two values nothing opens.
 */
export type MobileDrawerId = "preview" | "theme" | "actions" | "search";

export interface MobileDrillShellProps {
    level: EditorNavLevel;
    /** Drives the app bar's sync readout (queued-photo count for this job). */
    inspectionId: string;
    /** Property address — the inspection's own name on the root screen. */
    inspectionTitle: string;
    sectionTitle: string;
    itemLabel: string;
    onBack: () => void;
    onMore: () => void;
    onOpenSearch: () => void;
    onOpenPreview: () => void;
    /**
     * Walk forward: the next item in the report, or where the walk starts.
     * `null` only at the very last item, where there is nowhere left to go.
     */
    onNext: (() => void) | null;
    /** Whole-inspection completion, 0–100. Rendered as the root screen's ring. */
    percentComplete: number;
    /**
     * Open the capture screen for the item being edited. Drives the camera FAB,
     * which only exists on the item level — there is nothing to attach a photo
     * to on the section or item-list screens.
     */
    onCapture?: () => void;
    /** The screen for the current level. */
    children: ReactNode;
    /** Modals, file inputs and drawers that must stay mounted across levels. */
    overlays?: ReactNode;
}

/**
 * The phone report writer's shell: one screen at a time, inspection → section →
 * item, with the app bar naming where you are and what "back" means.
 *
 * ── Why a stack rather than the drawers it replaces ────────────────────────
 * The previous mobile view was the desktop three-rail layout folded into bottom
 * sheets: an item editor with the section list, item list and preview each
 * behind a drawer. That works as an adaptation and reads as one on a phone —
 * the inspector is always inside an item, and moving between items means
 * opening a sheet, choosing, and watching it close. A drill-down instead makes
 * position a first-class thing: you are on a screen, and back goes up. It is
 * also what makes the hardware back button mean something (see
 * `useEditorUrlNav`), which on Android is the button people actually press.
 *
 * The three screens are NOT new components. `SectionRail` and `ItemList` come
 * from `editor-shared` — the same components the desktop rails and the template
 * editor's preview render — handed a different `onSelect`. That is deliberate:
 * a phone-specific twin of either would drift from the desktop one, and only
 * one of the two would get the next fix.
 */
export function MobileDrillShell({
    level,
    inspectionId,
    inspectionTitle,
    sectionTitle,
    itemLabel,
    onBack,
    onMore,
    onOpenSearch,
    onOpenPreview,
    onNext,
    percentComplete,
    onCapture,
    children,
    overlays,
}: MobileDrillShellProps) {
    // The bar always names the CURRENT screen, with the level above it as the
    // eyebrow — so "back" is legible before it is pressed.
    const { eyebrow, title, backLabel } =
        level === "item"
            ? { eyebrow: sectionTitle, title: itemLabel, backLabel: m.editor_mobile_back_to_items() }
            : level === "items"
                ? { eyebrow: inspectionTitle, title: sectionTitle, backLabel: m.editor_mobile_back_to_sections() }
                : { eyebrow: m.editor_mobile_eyebrow_inspection(), title: inspectionTitle, backLabel: m.editor_mobile_back_to_inspections() };

    return (
        // `data-level` is the one thing the drill-down specs assert on. Which
        // screen is showing is otherwise only inferable from whichever list
        // happens to be rendered, and a text selector for that breaks the first
        // time a template renames a section.
        <div className="min-h-screen pb-14" data-testid="mobile-drill" data-level={level}>
            <MobileAppBar
                eyebrow={eyebrow}
                title={title}
                onBack={onBack}
                onMore={onMore}
                onSearch={onOpenSearch}
                backLabel={backLabel}
                syncPill={<MobileSyncPill inspectionId={inspectionId} />}
            />
            <main className="p-4 pb-24">{children}</main>

            {/* The most-used control on the screen, in the one place a thumb
                reaches without a regrip — and at a FIXED position, unlike the
                add tile in the photo strip, which sits behind a scroll and used
                to move every fourth photo. */}
            {level === "item" && onCapture && (
                <button
                    type="button"
                    onClick={onCapture}
                    data-testid="mobile-capture-fab"
                    aria-label={m.media_strip_add_photo_aria()}
                    className="fixed right-4 bottom-[72px] z-40 w-14 h-14 rounded-full bg-ih-primary text-ih-primary-fg shadow-ih-popover flex items-center justify-center active:scale-95 transition-transform"
                >
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <circle cx="12" cy="13" r="3.2" />
                    </svg>
                </button>
            )}

            <nav className="fixed left-0 right-0 bottom-0 z-30 h-14 bg-ih-bg-card border-t border-ih-border flex items-center">
                {/* Completion reads as a number, not only a ring: a ring alone
                    cannot be read at a glance in direct sun on a roof. */}
                <div className="flex-1 flex items-center justify-center gap-2" aria-live="polite">
                    <span
                        className="inline-block w-4 h-4 rounded-full border-2 border-ih-ok"
                        style={{
                            background: `conic-gradient(var(--color-ih-ok) ${percentComplete}%, transparent 0)`,
                        }}
                        aria-hidden="true"
                    />
                    <span className="text-[15px] font-bold tabular-nums text-ih-fg-2">
                        {m.editor_mobile_percent_complete({ percent: percentComplete })}
                    </span>
                </div>
                <button
                    onClick={onOpenPreview}
                    className="flex-1 flex flex-col items-center justify-center text-ih-fg-2 hover:bg-ih-bg-muted active:bg-ih-bg-muted min-h-11"
                >
                    <span className="text-[16px]" aria-hidden="true">👁</span>
                    <span className="text-[13px] uppercase tracking-[0.1em]">{m.editor_route_drawer_preview()}</span>
                </button>
                {/* Forward, in the slot Theme used to hold. Walking to the next
                    item is the single most repeated action of an inspection —
                    hundreds of times per property — and it was costing a trip
                    back up the stack. Theme is a once-a-day preference and now
                    lives in the ⋮ menu, which is what a preference deserves. */}
                <button
                    onClick={() => onNext?.()}
                    disabled={!onNext}
                    data-testid="mobile-next-item"
                    className="flex-1 flex flex-col items-center justify-center text-ih-fg-2 hover:bg-ih-bg-muted active:bg-ih-bg-muted min-h-11 disabled:opacity-40"
                >
                    <span className="text-[16px]" aria-hidden="true">→</span>
                    <span className="text-[13px] uppercase tracking-[0.1em]">{m.editor_mobile_next_item()}</span>
                </button>
            </nav>

            {overlays}
        </div>
    );
}
