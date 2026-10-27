import { useEffect, useRef, useState } from "react";
import type { PresenceStatus } from "~/hooks/usePresence";
import { SYNC_NOW_EVENT } from "~/lib/collab/photo-sync-mode";
import { m } from "~/paraglide/messages";
import { useSyncSignals } from "./useSyncSignals";

/** How long "All synced" stays up after the queue drains. */
const DONE_MS = 4000;

/**
 * Canvas X1: under the app bar, say plainly that going offline lost nothing.
 *
 * Three states, all derived from what the sync pill already reads (phone
 * network, live-socket status, local queue): offline, reconnecting, and a brief
 * "All synced" once a cut-off is over and the queue is empty. Anything else
 * renders nothing, so a healthy session has no banner at all.
 *
 * Retry has no reconnect to call: the browser, not this code, reconnects the
 * network and the socket. It re-reads `navigator.onLine` and, if the phone is
 * back, fires the same "sync now" event the held-photos pill uses.
 */
export function MobileOfflineBanner({ inspectionId, connection = "connected" }: { inspectionId: string; connection?: PresenceStatus }) {
    const { online, pending, recheck } = useSyncSignals(inspectionId);
    const [done, setDone] = useState(false);
    const wasCutOff = useRef(false);

    const offline = !online;
    const reconnecting = online && connection === "reconnecting";
    const healthy = online && connection === "connected" && pending === 0;

    useEffect(() => {
        if (offline || reconnecting) {
            wasCutOff.current = true;
            setDone(false);
        } else if (healthy && wasCutOff.current) {
            wasCutOff.current = false;
            setDone(true);
        }
    }, [offline, reconnecting, healthy]);

    useEffect(() => {
        if (!done) return;
        const t = setTimeout(() => setDone(false), DONE_MS);
        return () => clearTimeout(t);
    }, [done]);

    const retry = (): void => {
        recheck();
        if (navigator.onLine !== false) window.dispatchEvent(new Event(SYNC_NOW_EVENT));
    };

    const view = offline
        ? {
              state: "offline",
              tone: "bg-ih-watch-bg text-ih-watch-fg border-ih-watch",
              title: m.editor_offline_title(),
              sub: pending > 0 ? m.editor_offline_sub({ count: pending, s: pending === 1 ? "" : "s" }) : m.editor_offline_sub_ratings(),
          }
        : reconnecting
          ? { state: "reconnecting", tone: "bg-ih-bg-card text-ih-fg-2 border-ih-border-strong", title: m.editor_footer_status_reconnecting(), sub: m.editor_offline_keep_working() }
          : done
            ? { state: "synced", tone: "bg-ih-ok-bg text-ih-ok-fg border-ih-ok", title: m.editor_offline_synced_title(), sub: m.editor_offline_synced_sub() }
            : null;
    if (!view) return null;

    return (
        <section role="status" data-testid="mobile-offline-banner" data-banner-state={view.state} className={`md:hidden min-h-18 flex items-center gap-3 border-b py-2.5 pl-4 pr-3 ${view.tone}`}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[16px] font-bold">{view.title}</span>
                <span className="text-[14px]">{view.sub}</span>
            </span>
            {offline && (
                <button type="button" onClick={retry} className="h-11 shrink-0 rounded-md border border-ih-watch px-3.5 text-[16px] font-extrabold">
                    {m.editor_offline_retry()}
                </button>
            )}
        </section>
    );
}
