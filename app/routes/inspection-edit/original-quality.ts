/* ------------------------------------------------------------------ */
/* Upload quality preference (N2+N4)                                    */
/* ------------------------------------------------------------------ */

/**
 * Device-local opt-out for the upload preprocessing pass. Default OFF means
 * preprocessing is ON (downscale + EXIF/GPS strip). Persisted to localStorage
 * so the choice survives reloads and is read at all three photo entry points
 * (item picker, burst commit, offline replay) from one source of truth.
 *
 * Lives beside the editor route rather than inside it so the photo-upload hook
 * can read the preference without importing the route module it is imported
 * BY. `inspection-edit.tsx` re-exports both names, because
 * `InspectionSettingsSheet` writes the key through that path.
 */
export const ORIGINAL_QUALITY_KEY = "oi.uploads.originalQuality";

export function originalQualityEnabled(): boolean {
    try {
        return typeof localStorage !== "undefined" && localStorage.getItem(ORIGINAL_QUALITY_KEY) === "1";
    } catch {
        return false;
    }
}
