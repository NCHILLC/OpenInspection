import { useEffect, useState } from "react";
import { currentConnectionType, gateDrain, onConnectionTypeChange, photoSyncMode, SYNC_NOW_EVENT } from "~/lib/collab/photo-sync-mode";
import type { PresenceStatus } from "~/hooks/usePresence";
import { m } from "~/paraglide/messages";
import { SignInAgainLink } from "./SignInAgainLink";
import { useSyncSignals } from "./useSyncSignals";

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
 * `connection` is the same status the desktop `FooterBar` shows. Its "expired"
 * is the one state the inspector can end themselves, so there the label is the
 * link that does it.
 */
export function MobileSyncPill({ inspectionId, connection = "connected" }: { inspectionId: string; connection?: PresenceStatus }) {
    const { online, pending } = useSyncSignals(inspectionId);

    // Three states, and the count is always a NUMBER — a coloured dot alone
    // cannot be read at arm's length in glare, which is the whole failure mode
    // this replaces.
    // Held: the sync mode is keeping photos on the phone until the inspector
    // says go (or wi-fi appears). Tapping the pill is that "go".
    const [, bump] = useState(0);
    useEffect(() => onConnectionTypeChange(() => bump((n) => n + 1)), []);
    const held = pending > 0 && gateDrain(photoSyncMode(), currentConnectionType(), false) !== "go";
    const state = !online ? "offline" : connection !== "connected" ? connection : held ? "held" : pending > 0 ? "uploading" : "synced";
    const label =
        state === "offline"
            ? m.editor_mobile_sync_offline({ count: pending })
            : state === "expired"
                ? <SignInAgainLink>{m.editor_session_expired_short()}</SignInAgainLink>
            : state === "reconnecting"
                ? m.editor_footer_status_reconnecting()
                : state === "connecting"
                    ? m.editor_footer_status_connecting()
                    : state === "held"
                        ? m.editor_mobile_sync_held({ count: pending })
                    : state === "uploading"
                        ? m.editor_mobile_sync_uploading({ count: pending })
                        : m.editor_mobile_sync_ok();
    // A fresh page is "connecting" for a moment and that is not a warning, so
    // it stays neutral — the same reading the desktop footer gives it.
    const tone =
        state === "expired"
            ? "bg-ih-bad-bg text-ih-bad-fg"
            : state === "connecting"
                ? "bg-ih-bg-muted text-ih-fg-2"
                : state === "synced"
                    ? "bg-ih-ok-bg text-ih-ok-fg"
                    : "bg-ih-watch-bg text-ih-watch-fg";
    const dot = state === "expired" ? "bg-ih-bad" : state === "connecting" ? "bg-ih-fg-3" : state === "synced" ? "bg-ih-ok" : "bg-ih-watch";

    const Tag = state === "held" ? "button" : "span";
    return (
        <Tag
            {...(state === "held" ? { type: "button" as const, onClick: () => window.dispatchEvent(new Event(SYNC_NOW_EVENT)) } : {})}
            data-testid="mobile-sync-pill"
            data-sync-state={state}
            aria-live="polite"
            className={`shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums ${tone}`}
        >
            <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${dot}`} />
            {label}
        </Tag>
    );
}
