/**
 * A dialog whose blocker arms for BOTH layouts must MOUNT for both.
 *
 * `inspection-edit.tsx` returns early for the phone (`if (isMobile)`), so
 * anything written below that return exists only on desktop. `useBlocker` does
 * not care: it is called once, above the branch, and arms on every layout.
 *
 * With `<UnsavedChangesBlocker>` below the return, a phone with a dirty
 * inspection refused to navigate — React Router blocked it, nothing rendered to
 * release it, and the blocked state never resets — so the section list's back
 * arrow, the only `goUp` path that changes the PATHNAME, went dead for the rest
 * of the session with no request and no UI. The drill-down E2E cannot see it:
 * it only clicks navigation, never a photo, and `state.dirty` is set in exactly
 * one place (`usePhotoOps.patchItemPhotos`).
 *
 * ⚠️ THIRD TIME. Publish and Sign were lost the same way (`finishActionsEl`'s
 * own docblock), then the photo viewer and annotator (738bf96). Asserted on
 * source position because that is where the fault lives — both spellings
 * render, and only one of them mounts on the device inspectors carry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = 'app/routes/inspection-edit.tsx';
const src = readFileSync(join(__dirname, '..', '..', '..', ROUTE), 'utf8');

describe('the phone layout mounts the dialogs its hooks arm', () => {
    // The LAYOUT branch, not the two one-line `if (isMobile) { … return; }`
    // guards inside the select handlers — those sit far earlier in the file.
    const mobileReturn = src.search(/if \(isMobile\) \{\s+return \(/);

    it('has a mobile early return to be above', () => {
        expect(mobileReturn, `${ROUTE} no longer branches on isMobile`).toBeGreaterThan(-1);
    });

    it('renders the unsaved-changes blocker above it, not in the desktop-only tail', () => {
        const rendered = src.indexOf('<UnsavedChangesBlocker');
        expect(rendered, 'the blocker is rendered at all').toBeGreaterThan(-1);
        expect(
            rendered,
            'the release for a blocker armed on both layouts is mounted below the phone return, '
            + 'so a dirty inspection traps the inspector with no way out',
        ).toBeLessThan(mobileReturn);
    });

    it('arms the blocker above it too — the half that was never the bug', () => {
        expect(src.indexOf('useUnsavedChanges(')).toBeLessThan(mobileReturn);
    });
});
