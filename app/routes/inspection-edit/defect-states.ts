import type { DefectFieldsValue } from "~/components/editor/DefectFieldsRow";

/**
 * The per-defect field state the editor row reads, keyed by cannedId.
 *
 * Lives here rather than inline in the route because `inspection-edit.tsx` sits
 * at its size cap, and because this is a pure read of `result.tabs.defects`
 * with its own reason to change.
 *
 * EVERY FIELD THE ROW CAN EDIT MUST BE READ BACK HERE. A field written by the
 * UI but missing from this projection looks like a dead control: the write
 * lands, the row re-reads `undefined`, and it snaps back to its default on the
 * next render. That is exactly how the severity control shipped inert.
 */
export function buildDefectStates(activeResult: unknown): Map<string, DefectFieldsValue> {
    const map = new Map<string, DefectFieldsValue>();
    const defects = (activeResult as Record<string, unknown> | null)?.tabs as
        | { defects?: Array<Record<string, unknown>> }
        | undefined;
    const rows = Array.isArray(defects?.defects) ? defects!.defects : [];
    for (const d of rows) {
        const cannedId = typeof d.cannedId === "string" ? d.cannedId : "";
        if (!cannedId) continue;
        map.set(cannedId, {
            category:  typeof d.category  === "string" ? d.category  : null,
            location:  typeof d.location  === "string" ? d.location  : null,
            trade:     typeof d.trade     === "string" ? (d.trade     as DefectFieldsValue["trade"])     : null,
            deadline:  typeof d.deadline  === "string" ? (d.deadline  as DefectFieldsValue["deadline"])  : null,
            timeframe: typeof d.timeframe === "string" ? (d.timeframe as DefectFieldsValue["timeframe"]) : null,
        });
    }
    return map;
}
