/**
 * What a template's canned comments look like, and the three tabs they sit in.
 *
 * These live in `editor-shared/` rather than beside `CannedCommentTabs` because
 * the layer below needs them: `item-tab-projections` reads an item's recorded
 * state against the template's entries, and `editor-shared/` deliberately
 * imports nothing from `editor/` — shared is the lower layer, and inverting that
 * for three interfaces would be the first crack in it.
 *
 * `CannedCommentTabs` re-exports all three, so every existing import of them
 * from that module still resolves.
 */

export interface CannedInfoComment {
    id: string;
    title: string;
    comment: string;
    default: boolean;
    /** Checklist-style answer options defined on the template comment. */
    choices?: string[];
}

export interface CannedDefect {
    id: string;
    title: string;
    category: string;
    location: string;
    comment: string;
    photos: string[];
    default: boolean;
    /** Checklist-style answer options defined on the template comment. */
    choices?: string[];
}

export type CannedTabId = "information" | "limitations" | "defects";
