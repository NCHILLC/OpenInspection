import { describe, it, expect } from 'vitest';
import { InspectionPrefsSchema, InspectionPrefsPatchSchema, DEFAULT_INSPECTION_PREFS, withDefaults } from '../../../server/lib/validations/inspection-prefs.schema';

describe('InspectionPrefsSchema', () => {
    it('accepts a valid prefs object and defaults autoAdvance to keyboard (B-18)', () => {
        const r = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating_notes',
            autoAdvanceDelayMs: 200,
            pinnedTagIds: ['tag1', 'tag2'],
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.autoAdvance).toBe('keyboard');
    });

    it('rejects an unknown autoAdvance mode', () => {
        const r = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating_notes',
            autoAdvance: 'sometimes',
            autoAdvanceDelayMs: 200,
            pinnedTagIds: [],
        });
        expect(r.success).toBe(false);
    });

    it('rejects an unknown cloneDefault', () => {
        const r = InspectionPrefsSchema.safeParse({
            cloneDefault: 'everything',
            autoAdvanceDelayMs: 200,
            pinnedTagIds: [],
        });
        expect(r.success).toBe(false);
    });

    it('clamps autoAdvanceDelayMs into [0, 2000]', () => {
        const tooLow = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating', autoAdvanceDelayMs: -10, pinnedTagIds: [],
        });
        expect(tooLow.success).toBe(false);
        const tooHigh = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating', autoAdvanceDelayMs: 5000, pinnedTagIds: [],
        });
        expect(tooHigh.success).toBe(false);
    });

    it('limits pinnedTagIds to 5 entries', () => {
        const r = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating', autoAdvanceDelayMs: 100,
            pinnedTagIds: ['a','b','c','d','e','f'],
        });
        expect(r.success).toBe(false);
    });
});

describe('InspectionPrefsPatchSchema', () => {
    it('accepts a partial patch', () => {
        const r = InspectionPrefsPatchSchema.safeParse({ cloneDefault: 'rating' });
        expect(r.success).toBe(true);
    });

    it('no longer accepts the retired "all" clone scope', () => {
        expect(InspectionPrefsPatchSchema.safeParse({ cloneDefault: 'all' }).success).toBe(false);
    });

    it('accepts empty object', () => {
        const r = InspectionPrefsPatchSchema.safeParse({});
        expect(r.success).toBe(true);
    });
});

describe('DEFAULT_INSPECTION_PREFS', () => {
    it('passes the full schema', () => {
        expect(InspectionPrefsSchema.safeParse(DEFAULT_INSPECTION_PREFS).success).toBe(true);
    });
});

describe('withDefaults', () => {
    it('reads a stored "all" clone scope as rating_notes', () => {
        expect(withDefaults({ cloneDefault: 'all' }).cloneDefault).toBe('rating_notes');
    });

    it('leaves the other scopes alone', () => {
        expect(withDefaults({ cloneDefault: 'rating' }).cloneDefault).toBe('rating');
    });
});

describe('InspectionPrefsPatchSchema', () => {
    it('a patch of one field carries no defaults for the others', () => {
        expect(InspectionPrefsPatchSchema.parse({ autoAdvance: 'off' })).toEqual({ autoAdvance: 'off' });
    });
});
