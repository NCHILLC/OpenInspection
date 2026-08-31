/**
 * B-18 — rating-level lookup + auto-advance policy.
 *
 * The editor stores whatever the rating buttons emit; historically the
 * desktop panel hardcoded 'SAT'/'MON'/'DEF' while rating-system levels carry
 * ids like 'Defect', so `levels.find(l => l.id === rating)` never matched and
 * the seeds' `pausesAdvance` intent (Defect/Monitor stop for notes) was dead.
 * `findRatingLevel` tolerates id / abbreviation / label, case-insensitive,
 * plus prefix matches so legacy stored abbreviations keep resolving.
 *
 * `ratingAdvanceDecision` centralises when rating an item moves to the next
 * one: pausing levels never advance (rate → describe → photo stays put), and
 * pointer clicks only advance in the explicit 'always' mode — keyboard 1-5 is
 * the speed-scan path, mouse/touch is the deliberate-editing path.
 */

export interface EditorRatingLevel {
  id: string;
  label?: string;
  name?: string;
  abbreviation?: string;
  color?: string;
  severity?: string;
  isDefect?: boolean;
  pausesAdvance?: boolean;
}

export type AutoAdvanceMode = 'always' | 'keyboard' | 'off';

export function findRatingLevel<T extends EditorRatingLevel>(
  levels: readonly T[],
  value: string | null | undefined,
): T | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;

  const fields = (l: T) => [l.id, l.abbreviation, l.label, l.name];

  // Exact (case-insensitive) match on id, abbreviation, label or name.
  for (const l of levels) {
    if (fields(l).some((f) => typeof f === 'string' && f.toLowerCase() === v)) return l;
  }
  // Prefix match either way ('DEF' ↔ 'Defect', 'Sat' ↔ 'SAT') — keeps legacy
  // stored abbreviations resolving against full-word levels and vice versa.
  for (const l of levels) {
    if (
      fields(l).some(
        (f) =>
          typeof f === 'string' &&
          f.length >= 2 &&
          v.length >= 2 &&
          (f.toLowerCase().startsWith(v) || v.startsWith(f.toLowerCase())),
      )
    ) {
      return l;
    }
  }
  return undefined;
}

export interface AdvanceDecision {
  advance: boolean;
  focusNotes: boolean;
}

export function ratingAdvanceDecision(opts: {
  source: 'pointer' | 'keyboard';
  level: EditorRatingLevel | undefined;
  mode: AutoAdvanceMode;
}): AdvanceDecision {
  if (opts.level?.pausesAdvance) return { advance: false, focusNotes: true };
  if (opts.mode === 'off') return { advance: false, focusNotes: false };
  if (opts.mode === 'keyboard') {
    return { advance: opts.source === 'keyboard', focusNotes: false };
  }
  return { advance: true, focusNotes: false };
}

/* C-14a — rating buttons render from the inspection's rating-system levels
 * (full words + always-on semantic colour). The hardcoded SAT/MON/DEF row
 * wrote ids the rest of the editor (severityForRatingId, getRatingColor,
 * pausesAdvance lookup) could never match. This fallback only covers the
 * no-levels edge and mirrors the server's fallback ids.
 *
 * It sits beside EditorRatingLevel rather than inside a component: it is the
 * default INSTANCE of that type, and a second editing surface reaching for a
 * fallback should reach for this one rather than write its own. */
export const FALLBACK_RATING_LEVELS: EditorRatingLevel[] = [
    // IN carries severity 'good' because that is how `findInspectedLevel` below
    // identifies the inspected tier — by severity, never by id or abbreviation.
    // Give it any other severity and activating F stops selecting IN, and every
    // inspected item files under "other" instead of satisfactory. Both failures
    // are silent.
    { id: "Inspected", label: "Inspected", abbreviation: "IN", severity: "good" },
    { id: "Not Inspected", label: "Not Inspected", abbreviation: "NI", severity: "minor" },
    { id: "Not Present", label: "Not Present", abbreviation: "NP", severity: "minor" },
];

/**
 * The level that means "I inspected this and it is satisfactory".
 *
 * Findings imply inspection: an inspector who recorded a defect plainly looked
 * at the item, so activating `F` on an unrated item selects this level rather
 * than leaving the item unanswered. Resolved from `severity: 'good'` — the
 * semantic marker every shipped preset gives its Inspected/Satisfactory tier —
 * and NOT from an id or abbreviation, because those differ per standard
 * ('S', 'I', 'IN') while the severity does not.
 *
 * Returns undefined for a rating system with no satisfactory tier, in which
 * case the caller must leave the rating alone rather than invent one.
 */
export function findInspectedLevel<T extends EditorRatingLevel>(
  levels: readonly T[],
): T | undefined {
  return levels.find((l) => l.severity === 'good');
}

/**
 * The rating to apply when the inspector activates `F`, or null to leave the
 * item's rating exactly as it is.
 *
 * Findings imply inspection, so an item with no answer yet gets the
 * satisfactory tier — F and IN then light together, which is what the row is
 * telling the inspector. An item that ALREADY carries an answer keeps it, even
 * when that answer is Not Inspected: silently rewriting an explicit NI would
 * discard the inspector's own statement about the item, and with it the
 * limitation that explains the NI. A defect recorded against a Not Inspected
 * item is a contradiction for the report to surface, not for this to paper over.
 */
export function ratingForFindingsActivation<T extends EditorRatingLevel>(
  activeLevel: T | null | undefined,
  levels: readonly T[],
): string | null {
  if (activeLevel) return null;
  return findInspectedLevel(levels)?.id ?? null;
}
