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
}

/**
 * Mobile (<768px) top app bar — a 64px bar carrying the
 * drill-down stack's context (where you are, one level up) plus back/more.
 *
 * The two text props are named for what they RENDER rather than what they
 * happen to hold: the stack shows inspection → section → item, so the pair is
 * "section / item" only on the deepest screen.
 */
export function MobileAppBar({ eyebrow, title, onBack, onMore, onSearch, backLabel }: MobileAppBarProps) {
    return (
        // h-16, and every control 48dp: the bar an inspector hits hundreds of
        // times a job clears the 48dp floor, not only the 44pt one.
        <header className="sticky top-0 z-30 h-16 bg-ih-bg-card border-b border-ih-border flex items-center px-1 gap-1">
            <IconButton
                onClick={onBack}
                className="w-12 h-12"
                aria-label={backLabel ?? m.common_back()}
            ><Icon name="back" size={20} /></IconButton>
            <div className="flex-1 min-w-0 pl-1">
                <div className="text-[14px] font-semibold uppercase tracking-[0.08em] text-ih-fg-3 truncate">{eyebrow}</div>
                <div className="text-[22px] leading-tight font-bold truncate">{title}</div>
            </div>
            {onSearch && (
                <IconButton
                    onClick={onSearch}
                    className="w-12 h-12"
                    aria-label={m.editor_mobile_search()}
                ><Icon name="search" size={20} /></IconButton>
            )}
            <IconButton
                onClick={onMore}
                className="w-12 h-12"
                aria-label={m.editor_mobile_more()}
            >⋮</IconButton>
        </header>
    );
}
