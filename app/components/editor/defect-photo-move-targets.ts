import type * as Y from "yjs";
import { readResultMap } from "~/lib/collab/results-binding";
import { upsertCanned } from "../../../server/lib/collab/results-doc";
import type { PhotoMoveTarget } from '~/lib/collab/photo-destination';
import { getIncludedSet, type ItemTabs } from '../editor-shared/item-tab-projections';

export function defectPhotoMoveTargets(itemId: string, tabs: ItemTabs, result: Record<string, unknown>, targets: PhotoMoveTarget[]): PhotoMoveTarget[] {
    const context = targets.find(t => t.itemId === itemId && t.kind !== 'defect');
    if (!context?.sectionId) return [];
    const scope = { itemId, sectionId: context.sectionId, unitId: context.unitId ?? null };
    const included = getIncludedSet(tabs, result, 'defects');
    const custom = (result.customComments as { defects?: Array<{ id: string; title: string; included: boolean }> } | undefined)?.defects ?? [];
    return [
        ...(tabs.defects ?? []).filter(d => included.has(d.id)).map(d => ({
            ...scope, kind: 'defect' as const, defect: { kind: 'canned' as const, id: d.id }, label: d.title,
        })),
        ...custom.filter(d => d.included).map(d => ({
            ...scope, kind: 'defect' as const, defect: { kind: 'custom' as const, id: d.id }, label: d.title,
        })),
    ];
}

/** A category-only override still inherits the template's inclusion default. */
export function prepareDefectPhotoMove(doc: Y.Doc, findingKey: string,
    ref: { kind: 'canned' | 'custom'; id: string }, tabs: ItemTabs): boolean {
    const result = readResultMap(doc)[findingKey] ?? {};
    if (ref.kind === 'custom') return ((result.customComments as { defects?: Array<{ id: string; included?: boolean }> } | undefined)?.defects ?? [])
        .some(row => row.id === ref.id && row.included === true);
    if (!getIncludedSet(tabs, result, 'defects').has(ref.id)) return false;
    const rows = (result.tabs as { defects?: Array<{ cannedId: string; included?: boolean }> } | undefined)?.defects;
    if (!rows?.some(row => row.cannedId === ref.id && row.included === true)) {
        upsertCanned(doc, findingKey, 'defects', { cannedId: ref.id, included: true });
    }
    return true;
}
