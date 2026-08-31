/**
 * Which defect fields the publish gate requires, and how the two-level config
 * resolves. Its own unit because `shared.ts` sits at its size cap and this is a
 * self-contained rule with its own reason to change.
 */

export type RequireDefectFields = 'none' | 'location' | 'trade' | 'both';

/** Pure resolution of the two-level config — override (NULL = inherit) beats
 *  the tenant default; both unset → 'none' (loose).
 *
 *  TRADE IS COLLAPSED OUT: its selector was removed from the defect editor, so
 *  a stored 'trade'/'both' would demand a field nothing can fill and block
 *  publishing forever — the gate must not outlive the control that satisfied
 *  it. Stored values are untouched; only their effect here is dropped. */
export function resolveRequireDefectFields(
    override: RequireDefectFields | null | undefined,
    tenantDefault: RequireDefectFields | null | undefined,
): RequireDefectFields {
    const resolved = override ?? tenantDefault ?? 'none';
    if (resolved === 'trade') return 'none';
    if (resolved === 'both') return 'location';
    return resolved;
}
