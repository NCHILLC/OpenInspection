import { m } from "~/paraglide/messages";

/** The single severity vocabulary shared by rating levels AND comments (spec §4.F, §9 #1). */
export type Severity = 'good' | 'marginal' | 'significant' | 'safety' | 'minor';

/**
 * Order is the order every picker renders, and it is deliberate: ascending
 * defect grade, then the non-grade state.
 *
 * `minor` is NOT the bottom of a severity ramp despite the name — it is the
 * "does not apply" slot that Not Inspected / Not Present levels carry, which is
 * why it reads "N/A" and sits last. The stored words are kept as they are on
 * purpose: renaming them to match the display labels would rewrite the severity
 * of every existing comment and rating level for a cosmetic gain.
 */
export const SEVERITIES: readonly Severity[] = ['good', 'marginal', 'significant', 'safety', 'minor'];

/**
 * Display-only friendly labels. Severity is the stored word; these are shown read-only.
 * Labels are exposed as getters so the string resolves at access time (under the active
 * paraglide locale), not frozen at module-import time.
 */
export const SEVERITY_LABEL: Record<Severity, string> = {
  get good() { return m.label_severity_good(); },
  get marginal() { return m.label_severity_marginal(); },
  get significant() { return m.label_severity_significant(); },
  get safety() { return m.label_severity_safety(); },
  get minor() { return m.label_severity_minor(); },
};

/**
 * DS-0523 status-dot class per severity.
 *
 * `safety` shares `bg-ih-bad` with `significant`: the token set carries one
 * "bad" colour (ok / watch / bad / info), and inventing a second red here would
 * be a raw colour the design-system gate rejects. The two are distinguished by
 * label, not hue — worth revisiting if a critical token is ever added.
 */
export const SEVERITY_DOT: Record<Severity, string> = {
  good: 'bg-ih-ok',
  marginal: 'bg-ih-watch',
  significant: 'bg-ih-bad',
  safety: 'bg-ih-bad',
  minor: 'bg-ih-fg-4',
};

export function isSeverity(v: unknown): v is Severity {
  return typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v);
}
