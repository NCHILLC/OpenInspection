interface NextItemSection {
    id: string;
    items?: Array<{ id: string }>;
}

export interface NextItemTarget {
    sectionId: string;
    itemId: string;
}

/**
 * The next item to walk to, from wherever the inspector currently is.
 *
 * ⚠️ IT CROSSES SECTION BOUNDARIES ON PURPOSE. An inspection is walked front to
 * back, and stopping at the end of Roof to make someone go back, pick Exterior,
 * then pick its first item is three taps to continue doing the thing they were
 * already doing. "Next" means the next item in the report, not the next item in
 * this section.
 *
 * Sections with no items are stepped over rather than landed on — a template
 * can carry an empty section, and an inspector pressing Next should not have to
 * press it twice.
 *
 * Called with no active item, this answers "where does the walk start": the
 * first item of the section they are looking at, or of the report. That is what
 * makes the same control mean "begin" on the section list and "next" inside an
 * item, instead of being dead on two screens out of three.
 */
export function nextItemTarget(
    sections: NextItemSection[],
    currentSectionId: string | null,
    activeItemId: string | null,
): NextItemTarget | null {
    const flat: NextItemTarget[] = [];
    for (const section of sections) {
        for (const item of section.items ?? []) {
            flat.push({ sectionId: section.id, itemId: item.id });
        }
    }
    if (flat.length === 0) return null;

    if (activeItemId) {
        const at = flat.findIndex(
            (e) => e.itemId === activeItemId && (!currentSectionId || e.sectionId === currentSectionId),
        );
        // An unresolvable current item (a renamed template, a stale link) falls
        // through to the start rather than dead-ending the button.
        if (at >= 0) return flat[at + 1] ?? null;
    }

    if (currentSectionId) {
        const firstHere = flat.find((e) => e.sectionId === currentSectionId);
        if (firstHere) return firstHere;
    }

    return flat[0];
}
