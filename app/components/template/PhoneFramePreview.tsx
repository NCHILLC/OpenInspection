import { ItemEditor } from "../editor/ItemEditor";
import type { EditorRatingLevel } from "../../lib/rating-levels";
import type { TemplateItem } from "./types";
import { m } from "~/paraglide/messages";

const PHONE_WIDTH = 375;

export interface PhoneFramePreviewProps {
    selectedItem: TemplateItem;
    sectionTitle?: string;
    /**
     * The template's own rating system, in the authoring editor's shape — where
     * `id` is optional, because a level being authored right now may not have
     * been named yet.
     */
    ratingLevels: Array<Omit<EditorRatingLevel, "id"> & { id?: string }>;
    /** Tenant defect_categories colour lookup, keyed by name AND id. */
    categoryColor?: Map<string, string>;
    /** Tenant defect categories — resolves a stored id to a readable label. */
    defectCategories?: Array<{ id: string; name: string }>;
}

/** Authoring has no inspection behind it; every handler is a no-op. */
const inert = () => { /* preview only */ };

/**
 * What the inspector will actually see, at the width they will see it.
 *
 * ⚠️ THIS RENDERS `ItemEditor`, NOT A DRAWING OF IT. The panel this replaced
 * was a separate component that listed the same data in its own markup — a
 * faithful summary of what had been authored, and a poor answer to the question
 * an author is really asking, which is "what does this look like on a phone?".
 * It also had to be kept in step by hand: two renderings of one item, drifting
 * quietly, with a parity test standing between them.
 *
 * Rendering the real component removes the drift surface instead of testing it.
 * A title that truncates at 375px truncates here. A rating row that wraps,
 * wraps. Comments buried three taps behind a tab strip are buried here too —
 * which is itself the authoring signal, and one a flat summary cannot give.
 *
 * 375px is the iPhone-class width the editor's own `useIsMobile` breakpoint and
 * the mobile Playwright projects both use. The frame is scrollable because the
 * real screen is: an item with twenty canned defects does not fit, and pretending
 * otherwise in the preview is how a template ships unusable.
 */
export function PhoneFramePreview({
    selectedItem,
    sectionTitle,
    ratingLevels,
    categoryColor,
    defectCategories,
}: PhoneFramePreviewProps) {
    // A level with no id is dropped rather than cast through. The inspection
    // stores the id on `result.rating`, so an id-less level is one the inspector
    // could never actually pick — drawing it in the preview would promise a
    // control the shipped template will not have.
    const levels = ratingLevels.filter((l): l is EditorRatingLevel => Boolean(l.id));

    return (
        <div className="flex flex-col gap-2">
            <p className="text-[10px] uppercase tracking-widest text-ih-fg-3">
                {m.templates_edit_phone_preview_label({ width: PHONE_WIDTH })}
            </p>
            {/* The frame is the point: fixed at the phone's width so the author
                sees the wrapping and truncation the inspector will, not a
                comfortable desktop rail's worth of room. */}
            <div
                data-testid="phone-frame-preview"
                style={{ width: PHONE_WIDTH }}
                className="max-w-full shrink-0 overflow-x-hidden overflow-y-auto max-h-[70vh] rounded-xl border border-ih-border bg-ih-bg-app p-3"
            >
                <ItemEditor
                    item={selectedItem as never}
                    sectionTitle={sectionTitle}
                    result={{}}
                    ratingLevels={levels}
                    categoryColor={categoryColor}
                    defectCategories={defectCategories}
                    onRating={inert}
                    onNotes={inert}
                    onNotesBlur={inert}
                />
            </div>
        </div>
    );
}
