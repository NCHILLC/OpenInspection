import { useState, useEffect, useCallback, useRef } from "react";
import { isOffline } from "~/lib/network-failure";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PresenceUser {
  userId: string;
  name: string;
  photoUrl?: string | null;
  focusItemId?: string | null;
}

/**
 * FE-5 — tri-state so the UI can distinguish "still connecting" from "lost".
 * "expired" is a lost connection with a known cause: the server refuses the
 * socket because there is no session, so no amount of retrying will reopen it.
 */
export type PresenceStatus = "connecting" | "connected" | "reconnecting" | "expired";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF = 30_000;

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * React-side presence client. Connects to the WebSocket presence channel
 * for multi-inspector collaboration. Reconnects with exponential backoff,
 * sends heartbeat every 30s, exposes a reactive roster.
 */
export function usePresence(options: {
  inspectionId: string;
  userId: string;
  userName: string;
  photoUrl?: string | null;
  enabled?: boolean;
}) {
  const { inspectionId, userId, userName, photoUrl, enabled = true } = options;
  const [roster, setRoster] = useState<PresenceUser[]>([]);
  const [connected, setConnected] = useState(false);
  // FE-5: a fresh page used to flash "Disconnected" until the first WS open —
  // read as data loss by field users. Track connecting/connected/reconnecting.
  const [status, setStatus] = useState<PresenceStatus>("connecting");
  const everConnectedRef = useRef(false);
  // Held in a ref so each failed retry keeps the reading instead of flashing
  // "Reconnecting…" until its own session check answers.
  const expiredRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffRef = useRef(400);
  const closedRef = useRef(false);

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (closedRef.current || !enabled) return;
    if (!inspectionId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/inspections/${inspectionId}/presence/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      let opened = false;
      const downStatus = (): PresenceStatus =>
        expiredRef.current ? "expired" : everConnectedRef.current ? "reconnecting" : "connecting";

      ws.addEventListener("open", () => {
        opened = true;
        expiredRef.current = false;
        backoffRef.current = 400;
        everConnectedRef.current = true;
        setStatus("connected");
        setConnected(true);
        send({
          type: "hello",
          userId,
          name: userName,
          photoUrl: photoUrl ?? null,
        });
        heartbeatRef.current = setInterval(() => {
          send({ type: "heartbeat" });
        }, HEARTBEAT_MS);
      });

      ws.addEventListener("message", (ev) => {
        try {
          const m = JSON.parse(ev.data) as Record<string, unknown>;
          if (m.type === "roster") {
            setRoster((m.users as PresenceUser[]) || []);
          }
        } catch {
          /* malformed message */
        }
      });

      ws.addEventListener("close", () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
        setConnected(false);
        setStatus(downStatus());
        // A browser is never told why a WebSocket handshake was refused: a 401
        // and a dead network both arrive as a bare `close`. So a socket that
        // closed without opening asks the API, with the cookie the socket
        // itself sends, whether there is still a session. Only a 401 reads as
        // "expired"; the retries below carry on either way, so signing in from
        // another tab reconnects this one.
        if (!opened && !closedRef.current && !isOffline()) {
          void fetch("/api/auth/me").then(
            (res) => {
              expiredRef.current = res.status === 401;
              if (!closedRef.current && wsRef.current?.readyState !== WebSocket.OPEN) setStatus(downStatus());
            },
            () => { /* unreachable: a network problem, not a session one */ },
          );
        }
        // Schedule reconnect
        if (!closedRef.current) {
          setTimeout(() => connect(), backoffRef.current);
          backoffRef.current = Math.min(
            backoffRef.current * 2,
            MAX_BACKOFF,
          );
        }
      });

      ws.addEventListener("error", () => {
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      });
    } catch {
      // URL malformed or network blocked
      if (!closedRef.current) {
        setTimeout(() => connect(), backoffRef.current);
        backoffRef.current = Math.min(
          backoffRef.current * 2,
          MAX_BACKOFF,
        );
      }
    }
  }, [inspectionId, userId, userName, photoUrl, enabled, send]);

  const setFocus = useCallback(
    (itemId: string | null) => {
      send({ type: "focus", itemId });
    },
    [send],
  );

  const close = useCallback(() => {
    closedRef.current = true;
    try {
      send({ type: "bye" });
    } catch {
      /* swallow */
    }
    try {
      wsRef.current?.close();
    } catch {
      /* already closing */
    }
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    setConnected(false);
  }, [send]);

  // Auto-connect on mount, disconnect on unmount
  useEffect(() => {
    if (!enabled) return;
    closedRef.current = false;
    connect();
    return () => {
      close();
    };
  }, [enabled, inspectionId]);

  // Update focus when active item changes (caller passes this in)
  // This is exposed so the route can call setFocus(activeItemId)

  return {
    roster,
    connected,
    status,
    setFocus,
    close,
  };
}
