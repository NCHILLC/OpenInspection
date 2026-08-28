/** The shape both progress and search read: one item's stored result. */
interface ItemResultLike {
    rating?: unknown;
    value?: unknown;
}

/**
 * Has the inspector finished with this item?
 *
 * ⚠️ ONE DEFINITION, BECAUSE TWO DISAGREED. `progress` (the overall ring)
 * counted an item done on a rating OR a non-empty value; `sectionProgress` (the
 * section rail's percentage and its checkmark) counted only the rating. They
 * sat in the same file with nothing to explain the difference, so a section of
 * filled-in text/number/date items read 0% on the rail while the overall ring
 * counted every one of them — the inspector sees a section that looks untouched
 * and a total that says otherwise, and has no way to tell which is lying.
 *
 * A rated item is done. A non-rich item is done once it holds a value, because
 * a rating is not something its editor can even offer — `photo_only`, `text`,
 * `number`, `date` and friends store on `result.value`, and holding the section
 * rail to a rating they cannot have is what produced the 0%.
 *
 * Report search's "Incomplete" filter reads this too. A filter that disagreed
 * with the ring about the same item would send an inspector hunting for work
 * the progress display considers finished.
 */
export function isItemComplete(result: ItemResultLike | undefined | null): boolean {
    if (!result) return false;
    if (result.rating) return true;
    const v = result.value;
    if (v === undefined || v === null || v === "") return false;
    // An empty multi-select is a field nobody answered, not an answer of "none".
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
}
