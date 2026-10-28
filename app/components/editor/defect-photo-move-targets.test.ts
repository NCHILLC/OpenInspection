import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { seedResultsDoc, upsertCanned } from '../../../server/lib/collab/results-doc';
import { defectPhotoMoveTargets, prepareDefectPhotoMove } from './defect-photo-move-targets';
import type { ItemTabs } from '../editor-shared/item-tab-projections';
describe('defect photo destinations', () => {
    it('offers only included canned and custom defects in the current item context', () => {
        const tabs = { defects: [{ id: 'on', title: 'On', default: true }, { id: 'off', title: 'Off', default: true }] } as ItemTabs;
        const result = { tabs: { defects: [{ cannedId: 'off', included: false }] }, customComments: { defects: [
            { id: 'custom', title: 'Custom', included: true }, { id: 'excluded', title: 'Excluded', included: false },
        ] } };
        const targets = defectPhotoMoveTargets('i', tabs, result, [{ kind: 'item', itemId: 'i', sectionId: 's', unitId: 'u', label: 'Item' }]);
        expect(targets.map(t => t.kind === 'defect' && t.defect)).toEqual([{ kind: 'canned', id: 'on' }, { kind: 'custom', id: 'custom' }]);
        expect(targets.every(t => t.itemId === 'i' && t.sectionId === 's' && t.unitId === 'u')).toBe(true);
        expect(defectPhotoMoveTargets('other', tabs, result, [])).toEqual([]);
    });
    it('prepares a default-included canned defect whose existing override only sets category', () => {
        const doc = new Y.Doc(); const findingKey = 'u:s:i';
        seedResultsDoc(doc, [{ findingKey }]);
        upsertCanned(doc, findingKey, 'defects', { cannedId: 'd', category: 'recommendation' });
        const tabs = { defects: [{ id: 'd', title: 'Leak', default: true }] } as ItemTabs;
        expect(prepareDefectPhotoMove(doc, findingKey, { kind: 'canned', id: 'd' }, tabs)).toBe(true);
        upsertCanned(doc, findingKey, 'defects', { cannedId: 'd', included: false });
        expect(prepareDefectPhotoMove(doc, findingKey, { kind: 'canned', id: 'd' }, tabs)).toBe(false);
        expect(prepareDefectPhotoMove(doc, findingKey, { kind: 'canned', id: 'not-in-template' }, tabs)).toBe(false);
    });

});
