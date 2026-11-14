import { makeCustomDefect } from "~/lib/custom-defects";
import type { CannedDefect } from "~/components/editor-shared/canned-comment-types";
import type { CollabFindingsApi } from "~/lib/collab/collab-findings-api";

type Where = { sectionId: string; itemId: string } | null;

/**
 * The item editor's Copy button and a custom defect's location field.
 *
 * Copy makes a custom defect from a template one, tagged with the original's
 * id so the editor lists it directly under that defect (it used to land at the
 * bottom of the list, below the library, where nobody saw it: a hidden,
 * still-checked copy kept a red defect line on the item after the inspector
 * unchecked the original). The original stays checked; the copy is for the
 * same problem at a second location, so it gets its own location field.
 */
export function customDefectHandlers(findings: Pick<CollabFindingsApi, "addCustomDefect">, where: () => Where) {
    return {
        onDuplicateCanned: (entry: CannedDefect): string | undefined => {
            const at = where();
            const d = at && makeCustomDefect({ title: entry.title, comment: entry.comment, category: entry.category, sourceCannedId: entry.id });
            if (!at || !d) return undefined;
            findings.addCustomDefect(at.sectionId, at.itemId, { ...d, comment: d.comment ?? "" });
            return d.id;
        },
        onCustomDefectFields: (customId: string, patch: { location: string | null }) => {
            const at = where();
            // Merges onto the existing entry (keyed by id); "" clears, as a template defect's field does.
            if (at) findings.addCustomDefect(at.sectionId, at.itemId, { id: customId, location: patch.location ?? "" });
        },
    };
}
