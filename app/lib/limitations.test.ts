// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
    STANDARD_LIMITATION_IDS,
    createCustomLimitation,
    includedLimitationCount,
    requiresLimitation,
} from '~/lib/limitations';

describe('requiresLimitation', () => {
    const NI = { abbreviation: 'NI', label: 'Not Inspected', severity: 'minor', isDefect: false };
    const NP = { abbreviation: 'NP', label: 'Not Present', severity: 'minor', isDefect: false };
    const IN = { abbreviation: 'IN', label: 'Inspected', severity: 'good', isDefect: false };

    it('requires a reason for Not Inspected', () => {
        expect(requiresLimitation(NI)).toBe(true);
    });

    // The distinction the whole rule turns on: Not Present needs no excuse,
    // because nothing was there to inspect.
    it('does NOT require one for Not Present, which sits in the same severity slot', () => {
        expect(requiresLimitation(NP)).toBe(false);
    });

    it('does not require one for an inspected item', () => {
        expect(requiresLimitation(IN)).toBe(false);
    });

    it('requires nothing when the item is unrated', () => {
        expect(requiresLimitation(null)).toBe(false);
        expect(requiresLimitation(undefined)).toBe(false);
    });

    // Read from metadata, not a hardcoded id: standards spell it differently
    // and a tenant may rename it.
    it('recognises a renamed Not Inspected level by what it says', () => {
        expect(requiresLimitation({ label: 'Not inspected this visit', severity: 'minor', isDefect: false })).toBe(true);
        expect(requiresLimitation({ label: 'Could not inspect', severity: 'minor', isDefect: false })).toBe(true);
        expect(requiresLimitation({ abbreviation: 'NI', severity: 'minor', isDefect: false })).toBe(true);
    });

    it('leaves an unrelated does-not-apply level alone', () => {
        expect(requiresLimitation({ label: 'Not Applicable', severity: 'minor', isDefect: false })).toBe(false);
    });

    it('never requires one for a defect level', () => {
        expect(requiresLimitation({ label: 'Not Inspected', severity: 'minor', isDefect: true })).toBe(false);
    });
});

describe('includedLimitationCount', () => {
    it('adds the template entries the inspector kept to the ones they wrote', () => {
        expect(includedLimitationCount(1, [{ included: true }, { included: true }])).toBe(3);
    });

    it('ignores custom entries the inspector turned off', () => {
        expect(includedLimitationCount(0, [{ included: false }, { included: true }])).toBe(1);
    });

    // A document older than the flag must not silently lose a stated reason.
    it('treats an absent included flag as included', () => {
        expect(includedLimitationCount(0, [{}])).toBe(1);
    });

    it('is zero for an item with nothing recorded', () => {
        expect(includedLimitationCount(0, undefined)).toBe(0);
    });
});

describe('createCustomLimitation', () => {
    it('produces an included entry carrying the reason', () => {
        const l = createCustomLimitation('  No access  ');
        expect(l.title).toBe('No access');
        expect(l.included).toBe(true);
        expect(l.id).toBeTruthy();
    });

    it('normalises the comment, empty when none was given', () => {
        expect(createCustomLimitation('Locked', '   ').comment).toBe('');
        expect(createCustomLimitation('Locked', 'Rear gate').comment).toBe('Rear gate');
    });

    it('gives every entry its own id', () => {
        expect(createCustomLimitation('a').id).not.toBe(createCustomLimitation('a').id);
    });
});

describe('STANDARD_LIMITATION_IDS', () => {
    // Ids, not display text: the label is resolved from the catalogue because
    // tapping a chip stores it as report content in the inspector's language.
    it('offers the common reasons, most likely first', () => {
        expect(STANDARD_LIMITATION_IDS[0]).toBe('no_access');
        expect(STANDARD_LIMITATION_IDS.length).toBeGreaterThanOrEqual(4);
    });

    it('has no duplicates', () => {
        expect(new Set(STANDARD_LIMITATION_IDS).size).toBe(STANDARD_LIMITATION_IDS.length);
    });
});
