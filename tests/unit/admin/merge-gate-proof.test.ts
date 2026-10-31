import { describe, expect, it } from 'vitest';

// Throwaway: fails on purpose to prove `verify` blocks a merge. Never merged.
describe('merge gate proof', () => {
    it('fails', () => {
        expect(1).toBe(2);
    });
});
