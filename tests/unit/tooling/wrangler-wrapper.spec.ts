/** `scripts/wrangler.mjs` retries once on Cloudflare 7403 (expired OAuth token). */
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain .mjs script, no type declarations
import { isExpiredToken } from '../../../scripts/wrangler.mjs';

describe('isExpiredToken', () => {
    it('matches a 7403 error', () => {
        expect(isExpiredToken('✘ [ERROR] A request to the Cloudflare API failed. [code: 7403]')).toBe(true);
    });

    it('ignores other output, including longer numbers containing 7403', () => {
        expect(isExpiredToken('Applied 3 migrations')).toBe(false);
        expect(isExpiredToken('migration 174030')).toBe(false);
        expect(isExpiredToken(undefined)).toBe(false);
    });
});
