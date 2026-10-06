import { useEffect, useState } from "react";
import { listPendingMedia } from "~/lib/collab/media-pending-store";
import type { PresenceStatus } from "~/hooks/usePresence";
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
 * It reads the three things that answer the question: is there a network, is
 * the server actually reachable, and how many captures are still in the local
 * queue. A live socket alone does not say the photos have landed, so it never
 * turns the pill green by itself — but a DEAD one must stop the pill saying
 * "Synced". `navigator.onLine` only reports that the phone has a network, not
 * that this server answers on it (one bar in a crawlspace, a captive portal, a
 * deploy in progress), and the edit made in that window is on the phone only.
 * `connection` is the same status the desktop `FooterBar` shows.
 */
export function MobileSyncPill({ inspectionId, connection = "connected" }: { inspectionId: string; connection?: PresenceStatus }) {
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
    const state = !online ? "offline" : connection !== "connected" ? connection : pending > 0 ? "uploading" : "synced";
    const label =
        state === "offline"
            ? m.editor_mobile_sync_offline({ count: pending })
            : state === "reconnecting"
                ? m.editor_footer_status_reconnecting()
                : state === "connecting"
                    ? m.editor_footer_status_connecting()
                    : state === "uploading"
                        ? m.editor_mobile_sync_uploading({ count: pending })
                        : m.editor_mobile_sync_ok();
    // A fresh page is "connecting" for a moment and that is not a warning, so
    // it stays neutral — the same reading the desktop footer gives it.
    const tone =
        state === "offline"
            ? "bg-ih-bad-bg text-ih-bad-fg"
            : state === "connecting"
                ? "bg-ih-bg-muted text-ih-fg-2"
                : state === "synced"
                    ? "bg-ih-ok-bg text-ih-ok-fg"
                    : "bg-ih-watch-bg text-ih-watch-fg";
    const dot = state === "offline" ? "bg-ih-bad" : state === "connecting" ? "bg-ih-fg-3" : state === "synced" ? "bg-ih-ok" : "bg-ih-watch";

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
