import { getIncludedSet, type ItemTabs } from "../editor-shared/item-tab-projections";

/** Count the same item and included-defect attachments the report can show, including queued photos. */
export function checklistPhotoCount(tabs: ItemTabs, result: Record<string, unknown>): number {
    const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
    const included = getIncludedSet(tabs, result, "defects");
    const canned = (result.tabs as { defects?: Array<{ cannedId: string; photos?: unknown[] }> } | undefined)?.defects ?? [];
    const custom = (result.customComments as { defects?: Array<{ included?: boolean; photos?: unknown[] }> } | undefined)?.defects ?? [];
    return count(result.photos)
        + canned.reduce((n, d) => n + (included.has(d.cannedId) ? count(d.photos) : 0), 0)
        + custom.reduce((n, d) => n + (d.included !== false ? count(d.photos) : 0), 0);
}
