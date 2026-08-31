/**
 * Why an item could not be inspected.
 *
 * A limitation is the reason attached to a Not Inspected rating: "I did not
 * examine this, and here is why". The report needs that reason — an unexplained
 * NI is the gap a client notices and an inspector cannot defend later.
 *
 * THE PICKLIST LIVES HERE, NOT IN THE TEMPLATES, and that is deliberate. A
 * template CAN ship per-item limitation entries (the Limitations tab renders
 * them exactly like canned information), but none of the seeded templates does,
 * and the reasons inspectors actually give are not item-specific: a locked door
 * reads the same over a crawlspace as over an attic. Authoring the same six
 * reasons onto every item of every template would be a large amount of
 * duplicated content that still would not cover the seventh reason — so the
 * common ones are offered everywhere from one list, and anything else is typed.
 *
 * Picking one writes a CUSTOM limitation (`customComments.limitations`), the
 * same shape a typed one produces. The report therefore reads one kind of
 * entry, and an inspector can edit a picked reason afterwards like any other.
 */

/** A hand-recorded limitation, mirroring `CustomDefect`'s shape. */
export interface CustomLimitation {
    id: string;
    title: string;
    /** Always present, empty when none — `CustomCommentEntry.comment` is
     *  required, and matching it means the entry can be stored whole. */
    comment: string;
    included: boolean;
}

/**
 * The reasons offered as one-tap chips, ordered by how often they are the
 * answer so the common case is the first thing under the thumb.
 *
 * IDS, not display text, because tapping one STORES its label as the
 * limitation's title — report content, not chrome. An inspector working in
 * Spanish should get the same sentence they would have typed, so the label is
 * resolved through the message catalogue at the point of use.
 */
export const STANDARD_LIMITATION_IDS = [
    'no_access',
    'locked',
    'not_in_service',
    'weather',
    'belongings',
    'unsafe',
] as const;

export type StandardLimitationId = typeof STANDARD_LIMITATION_IDS[number];

/** A blank custom limitation carrying `title`, ready to be included. */
export function createCustomLimitation(title: string, comment = ''): CustomLimitation {
    return {
        id: crypto.randomUUID(),
        title: title.trim(),
        comment: comment.trim(),
        included: true,
    };
}

/**
 * The limitations recorded on an item, whatever their origin.
 *
 * Counts a template's own limitation entries the inspector has included, plus
 * every custom one still marked included. An absent `included` reads as
 * included — a document written before the flag existed must not silently lose
 * the inspector's stated reason.
 */
export function includedLimitationCount(
    templateIncluded: number,
    custom: ReadonlyArray<{ included?: boolean }> | undefined,
): number {
    const hand = (custom ?? []).filter((l) => l.included !== false).length;
    return templateIncluded + hand;
}

/**
 * Whether `rating` is an answer that REQUIRES a limitation.
 *
 * Resolved from the level's own metadata rather than an id or label: 'NI' here,
 * 'Not Inspected' elsewhere, and a tenant may rename it entirely. A level means
 * "not inspected" when it is a non-defect level whose severity is the
 * does-not-apply slot AND whose name says so — Not Present sits in the same
 * severity slot but needs no excuse, because nothing was there to inspect.
 */
export function requiresLimitation(
    level: { severity?: string; isDefect?: boolean; abbreviation?: string; label?: string; name?: string } | null | undefined,
): boolean {
    if (!level || level.isDefect || level.severity !== 'minor') return false;
    const names = [level.abbreviation, level.label, level.name];
    return names.some((n) => typeof n === 'string' && /not\s*inspect/i.test(n)) ||
        names.some((n) => typeof n === 'string' && n.trim().toUpperCase() === 'NI');
}
