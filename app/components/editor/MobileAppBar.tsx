import type { ReactNode } from "react";
import { Icon, IconButton } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface MobileAppBarProps {
    /** Small caps line above the title — the level this screen sits under. */
    eyebrow: string;
    /** What this screen is: the inspection, a section, or an item. */
    title: string;
    onBack: () => void;
    onMore: () => void;
    /** Opens report search. Absent on screens where there is nothing to search. */
    onSearch?: () => void;
    /** Accessible name for the back control, which changes meaning per level. */
    backLabel?: string;
    /** Live connection + queued-photo readout. Never hidden — see MobileSyncPill. */
    syncPill?: ReactNode;
}

/**
 * Mobile (<768px) top app bar — a compact 12px-tall bar carrying the
 * drill-down stack's context (where you are, one level up) plus back/more.
 *
 * The two text props are named for what they RENDER rather than what they
 * happen to hold: the stack shows inspection → section → item, so the pair is
 * "section / item" only on the deepest screen.
 */
export function MobileAppBar({ eyebrow, title, onBack, onMore, onSearch, backLabel, syncPill }: MobileAppBarProps) {
    return (
        // h-14, and every control 44dp: these were w-10 h-10 (40px), under both
        // the 44pt and 48dp touch floors, on the bar an inspector hits hundreds
        // of times a job.
        <header className="sticky top-0 z-30 h-14 bg-ih-bg-card border-b border-ih-border flex items-center px-2 gap-2">
            <IconButton
                onClick={onBack}
                className="w-11 h-11"
                aria-label={backLabel ?? m.common_back()}
            ><Icon name="back" size={20} /></IconButton>
            <div className="flex-1 min-w-0">
                <div className="text-[13px] uppercase tracking-[0.1em] text-ih-fg-3 truncate">{eyebrow}</div>
                <div className="text-[16px] font-bold truncate">{title}</div>
            </div>
            {syncPill}
            {onSearch && (
                <IconButton
                    onClick={onSearch}
                    className="w-11 h-11"
                    aria-label={m.editor_mobile_search()}
                ><Icon name="search" size={20} /></IconButton>
            )}
            <IconButton
                onClick={onMore}
                className="w-11 h-11"
                aria-label={m.editor_mobile_more()}
            >⋮</IconButton>
        </header>
    );
}
