/**
 * One-line haptic confirmation.
 *
 * In an attic, in gloves, with the phone at an angle, the only way an inspector
 * could confirm a tap registered was to look at it — and the confirmation toast
 * rendered underneath the bottom nav. That is the loop that makes people
 * double-enter. `navigator.vibrate` had zero occurrences in this repo.
 *
 * iOS Safari does not implement it, so this is a no-op there rather than an
 * error. Not worth a WebKit workaround: Android is where the gloves-and-attic
 * case pays, and a silent no-op is the correct behaviour everywhere else.
 * Wrapped in try/catch because a vibrate inside an iframe without a user
 * gesture throws in some engines.
 */
export function haptic(pattern: number | number[] = 12): void {
    try {
        navigator.vibrate?.(pattern);
    } catch {
        /* unsupported or blocked — visual feedback still stands on its own */
    }
}

/** Something landed and the walk continues: a rating, a defect, a photo. */
export const HAPTIC_TAP = 12;
