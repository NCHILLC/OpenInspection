/**
 * When queued inspection photos leave the device.
 *
 * Photos always save to the local queue first (media-pending-store.ts); this
 * only decides when the drain is allowed to upload them. Device-local on
 * purpose, like the original-quality preference: the reason for choosing is the
 * phone's battery and signal, and the drain has to read it with no network.
 *
 *  - auto   : upload whenever there is a connection (the original behaviour).
 *  - prompt : hold, and ask the inspector once a connection returns.
 *  - wifi   : upload only on wi-fi / ethernet. Where the browser cannot tell
 *             the connection type (iOS Safari has no `navigator.connection`),
 *             the type is unknown and it behaves like `prompt`.
 *
 * A manual "Sync now" overrides every mode.
 */

export const PHOTO_SYNC_MODE_KEY = 'oi.uploads.syncMode';

export type PhotoSyncMode = 'auto' | 'prompt' | 'wifi';

/** go = upload now; ask = hold and prompt the inspector; wait = hold quietly (known cellular, wi-fi mode). */
export type DrainGate = 'go' | 'ask' | 'wait';

const MODES: readonly PhotoSyncMode[] = ['auto', 'prompt', 'wifi'];

export function photoSyncMode(): PhotoSyncMode {
    try {
        const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(PHOTO_SYNC_MODE_KEY);
        return MODES.includes(v as PhotoSyncMode) ? (v as PhotoSyncMode) : 'auto';
    } catch {
        return 'auto';
    }
}

export function setPhotoSyncMode(mode: PhotoSyncMode): void {
    try {
        if (mode === 'auto') localStorage.removeItem(PHOTO_SYNC_MODE_KEY);
        else localStorage.setItem(PHOTO_SYNC_MODE_KEY, mode);
    } catch {
        /* private mode / disabled storage: the choice simply does not persist */
    }
}

interface NetworkInformationLike {
    type?: string;
    addEventListener?: (type: 'change', fn: () => void) => void;
    removeEventListener?: (type: 'change', fn: () => void) => void;
}

function connection(): NetworkInformationLike | undefined {
    return typeof navigator === 'undefined'
        ? undefined
        : (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

/** `navigator.connection.type` where the browser exposes it, else undefined. */
export function currentConnectionType(): string | undefined {
    return connection()?.type;
}

/** Subscribe to connection-type changes. No-op where unsupported. Returns an unsubscribe. */
export function onConnectionTypeChange(fn: () => void): () => void {
    const c = connection();
    c?.addEventListener?.('change', fn);
    return () => c?.removeEventListener?.('change', fn);
}

/** May the drain upload right now? `forced` is a manual Sync now. */
export function gateDrain(mode: PhotoSyncMode, connectionType: string | undefined, forced: boolean): DrainGate {
    if (forced || mode === 'auto') return 'go';
    if (mode === 'prompt') return 'ask';
    // wifi
    if (connectionType === 'wifi' || connectionType === 'ethernet') return 'go';
    return connectionType === undefined || connectionType === 'unknown' ? 'ask' : 'wait';
}

/** Fired by the pill / toast; useMediaDrain listens and drains regardless of mode. */
export const SYNC_NOW_EVENT = 'oi:media-sync-now';
