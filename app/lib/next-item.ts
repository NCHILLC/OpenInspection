interface NextItemSection {
    id: string;
    items?: Array<{ id: string; label?: string; name?: string }>;
}

export interface NextItemTarget {
    sectionId: string;
    itemId: string;
    /** What the item is called, for the control that walks to it. */
    label?: string;
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
 * first item of the section they are looking at, or of the report. The phone's
 * list screens no longer ask it that; they rate inline and walk checklists with
 * `nextUnratedSection` below.
 */
export function nextItemTarget(
    sections: NextItemSection[],
    currentSectionId: string | null,
    activeItemId: string | null,
): NextItemTarget | null {
    const flat: NextItemTarget[] = [];
    for (const section of sections) {
        for (const item of section.items ?? []) {
            flat.push({ sectionId: section.id, itemId: item.id, label: item.label || item.name });
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

interface UnratedSection {
    id: string;
    title?: string;
    items?: Array<{ id: string; label?: string; name?: string }>;
}

/**
 * Where Next goes from a list screen: the checklist that still has work in it.
 *
 * From the inspection (`fromSectionId` null) that is the first section with an
 * unrated item. From a checklist it is the next such section AFTER this one,
 * wrapping to earlier ones: the inspector is leaving this checklist on purpose,
 * and sending them back into it would make Next a no-op. Null once every item
 * in the report is rated; there is no checklist left to walk to.
 */
export function nextUnratedSection(
    sections: UnratedSection[],
    isRated: (sectionId: string, itemId: string) => boolean,
    fromSectionId: string | null,
): { sectionId: string; label?: string; itemLabel?: string } | null {
    const at = fromSectionId ? sections.findIndex((s) => s.id === fromSectionId) : -1;
    const order = at < 0 ? sections : [...sections.slice(at + 1), ...sections.slice(0, at)];
    for (const s of order) {
        const item = (s.items ?? []).find((i) => !isRated(s.id, i.id));
        if (item) return { sectionId: s.id, label: s.title, itemLabel: item.label || item.name };
    }
    return null;
}
