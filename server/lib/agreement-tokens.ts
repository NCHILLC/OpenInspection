/**
 * Send-time merge fields for an agreement template.
 *
 * The starter template ships `[INSPECTOR_NAME]`, `[CUSTOMER_NAME]`,
 * `[PROPERTY_ADDRESS]`, `[INSPECTION_DATE]` and `$[AMOUNT]`. They are filled
 * from the inspection when the envelope is created, because the envelope's
 * `content_snapshot` is the permanent signed record: whatever is still in
 * brackets here is what the client signs and what a dispute produces.
 *
 * Anything bracketed that is NOT filled, and the starter's "review before
 * sending" notice, block the send instead (`blockingAgreementIssues`).
 */

export interface AgreementTokenValues {
    inspector?: string | null | undefined;
    client?: string | null | undefined;
    address?: string | null;
    /** Civil day, `YYYY-MM-DD` (an `T…Z` suffix is ignored). */
    date?: string | null;
    amountCents?: number | null;
}

/** Substring of the starter template's admin-only caveat paragraph. */
export const STARTER_NOTICE_MARK = 'Review before sending to real customers';

const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const longDay = (d: string): string | null => {
    const t = new Date(`${d.slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'long' });
};

export function fillAgreementTokens(html: string, v: AgreementTokenValues): string {
    const day = v.date ? longDay(v.date) : null;
    const map: Record<string, string | null> = {
        INSPECTOR_NAME:  v.inspector?.trim() || null,
        CUSTOMER_NAME:   v.client?.trim() || null,
        PROPERTY_ADDRESS: v.address?.trim() || null,
        INSPECTION_DATE: day,
        AMOUNT:          v.amountCents != null && v.amountCents > 0 ? (v.amountCents / 100).toFixed(2) : null,
        // Not known at send time. The signature itself and its timestamp are
        // recorded with the signer row; say so rather than leave a bracket.
        CLIENT_SIGNATURE_BLOCK: '(signature captured below)',
        SIGN_DATE:       '(recorded at signing)',
    };
    return html.replace(/\[([A-Z_]+)\]/g, (whole, key: string) => {
        const val = map[key];
        return val ? esc(val) : whole;
    });
}

/** Human-readable reasons this body must not be sent as it stands. */
export function blockingAgreementIssues(html: string): string[] {
    const issues: string[] = [];
    const tokens = [...new Set(html.match(/\[[A-Z][A-Z0-9_]{2,}\b[^\]]*\]/g) ?? [])]
        .map((t) => (t.length > 40 ? `${t.slice(0, 37)}...]` : t));
    if (tokens.length > 0) issues.push(`unfilled placeholders: ${tokens.join(', ')}`);
    if (html.includes(STARTER_NOTICE_MARK)) issues.push('the "review before sending" notice is still in the text');
    return issues;
}
