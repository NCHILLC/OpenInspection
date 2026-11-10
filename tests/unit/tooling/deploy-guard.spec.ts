/**
 * Unit tests for the deploy guard (`scripts/deploy-guard.mjs`): a deploy builds
 * the working tree, so it must refuse unless HEAD is origin/main and the
 * tracked tree is clean.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain .mjs script, no type declarations
import { evaluateGitState, trackedChanges } from '../../../scripts/deploy-guard.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('evaluateGitState', () => {
    it('passes when HEAD equals origin/main and nothing tracked changed', () => {
        expect(evaluateGitState({ head: SHA_A, originMain: SHA_A, dirtyFiles: [] })).toEqual({ ok: true, problems: [] });
    });

    it('fails when HEAD differs from origin/main', () => {
        const v = evaluateGitState({ head: SHA_A, originMain: SHA_B, dirtyFiles: [] });
        expect(v.ok).toBe(false);
        expect(v.problems.join('\n')).toContain('is not origin/main');
    });

    it('fails on a dirty tracked tree and names the files', () => {
        const v = evaluateGitState({ head: SHA_A, originMain: SHA_A, dirtyFiles: ['server/x.ts'] });
        expect(v.ok).toBe(false);
        expect(v.problems.join('\n')).toContain('server/x.ts');
    });

    it('fails closed when a sha is unreadable', () => {
        expect(evaluateGitState({ head: '', originMain: SHA_A, dirtyFiles: [] }).ok).toBe(false);
        expect(evaluateGitState({ head: SHA_A, originMain: '', dirtyFiles: [] }).ok).toBe(false);
    });
});

describe('trackedChanges', () => {
    it('ignores untracked files and keeps modified, staged and deleted ones', () => {
        const porcelain = ' M a.ts\nM  b.ts\n D c.ts\n?? scratch.txt\n';
        expect(trackedChanges(porcelain)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    });

    it('is empty for a clean tree', () => {
        expect(trackedChanges('')).toEqual([]);
    });
});
