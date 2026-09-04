import { useEffect, useState } from "react";
import { listPendingMedia } from "~/lib/collab/media-pending-store";
import { m } from "~/paraglide/messages";

/** Poll interval while photos are queued. Slow on purpose: the pill is a
 *  reassurance readout, not a progress bar, and this runs on a phone. */
const POLL_MS = 3000;

/**
 * "Is my work safe?" — answered on the device that goes into the crawlspace.
 *
 * Every sync signal in this editor lived in `FooterBar`, which is
 * `hidden md:flex`. On a phone there was no connection state, no pending count
 * and no confirmation that anything reached the server; the only offline cue
 * anywhere in the mobile tree was an 8px per-thumbnail badge. An inspector who
 * cannot see that their data is safe re-verifies it by hand, which is exactly
 * the work the offline engine was built to make unnecessary.
 *
 * It reads the two things that actually answer the question — is there a
 * network, and how many captures are still in the local queue — rather than the
 * collaboration socket's state. A live WebSocket says the editor is in sync
 * with other editors; it does not say the photos have landed.
 */
export function MobileSyncPill({ inspectionId }: { inspectionId: string }) {
    const [online, setOnline] = useState(true);
    const [pending, setPending] = useState(0);

    useEffect(() => {
        const sync = (): void => setOnline(navigator.onLine !== false);
        sync();
        window.addEventListener("online", sync);
        window.addEventListener("offline", sync);
        return () => {
            window.removeEventListener("online", sync);
            window.removeEventListener("offline", sync);
        };
    }, []);

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

    // Three states, and the count is always a NUMBER — a coloured dot alone
    // cannot be read at arm's length in glare, which is the whole failure mode
    // this replaces.
    const state = !online ? "offline" : pending > 0 ? "uploading" : "synced";
    const label =
        state === "offline"
            ? m.editor_mobile_sync_offline({ count: pending })
            : state === "uploading"
                ? m.editor_mobile_sync_uploading({ count: pending })
                : m.editor_mobile_sync_ok();
    const tone =
        state === "offline"
            ? "bg-ih-bad-bg text-ih-bad-fg"
            : state === "uploading"
                ? "bg-ih-watch-bg text-ih-watch-fg"
                : "bg-ih-ok-bg text-ih-ok-fg";
    const dot = state === "offline" ? "bg-ih-bad" : state === "uploading" ? "bg-ih-watch" : "bg-ih-ok";

    return (
        <span
            data-testid="mobile-sync-pill"
            data-sync-state={state}
            aria-live="polite"
            className={`shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums ${tone}`}
        >
            <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${dot}`} />
            {label}
        </span>
    );
}
