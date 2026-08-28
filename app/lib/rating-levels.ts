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
    { id: "Satisfactory", label: "Satisfactory", abbreviation: "Sat", severity: "good" },
    { id: "Monitor", label: "Monitor", abbreviation: "Mon", severity: "marginal", pausesAdvance: true },
    { id: "Defect", label: "Defect", abbreviation: "Def", severity: "significant", isDefect: true, pausesAdvance: true },
    { id: "Not Inspected", label: "Not Inspected", abbreviation: "N/I", severity: "minor" },
    { id: "Not Present", label: "Not Present", abbreviation: "N/P", severity: "minor" },
];
