import { useCallback, useEffect, useState } from "react";
import { listPendingMedia } from "~/lib/collab/media-pending-store";

/** Poll interval while photos are queued. Slow on purpose: the readouts are
 *  reassurance, not a progress bar, and this runs on a phone. */
const POLL_MS = 3000;

/**
 * The two device-side facts every phone sync readout is built from: does the
 * phone have a network, and how many captures are still in its local queue.
 * `recheck` re-reads the first on demand (the banner's Retry).
 */
export function useSyncSignals(inspectionId: string): { online: boolean; pending: number; recheck: () => void } {
    const [online, setOnline] = useState(true);
    const [pending, setPending] = useState(0);

    const recheck = useCallback((): void => setOnline(navigator.onLine !== false), []);

    useEffect(() => {
        recheck();
        window.addEventListener("online", recheck);
        window.addEventListener("offline", recheck);
        return () => {
            window.removeEventListener("online", recheck);
            window.removeEventListener("offline", recheck);
        };
    }, [recheck]);

    useEffect(() => {
        let alive = true;
        const read = (): void => {
            void listPendingMedia(inspectionId).then((rows) => {
                if (alive) setPending(rows.length);
            });
        };
        read();
        const t = setInterval(read, POLL_MS);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, [inspectionId]);

    return { online, pending, recheck };
}
