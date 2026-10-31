/**
 * The device half of the field log: an on-device buffer that survives bad
 * signal, and the recorders that fill it. Everything is a no-op until the
 * signed-in user's setting has switched it on for this device.
 *
 * Records ids, action names and paths only. Query strings never leave
 * `routeOf`, and an error's message is never read: both can hold client details.
 */
const ON_KEY = "oi:field-log:on";
const BUFFER_KEY = "oi:field-log:buffer";
export const FIELD_LOG_RESOURCE = "/resources/field-log";
const MAX_BUFFERED = 1000;
const BATCH = 100;
const FLUSH_DELAY_MS = 10_000;

type Kind = "screen" | "action" | "request_failed" | "crash" | "network" | "issue";

export interface FieldLogEvent {
  id: string;
  inspectionId: string;
  occurredAt: number;
  kind: Kind;
  name: string;
  route?: string;
  status?: number;
  note?: string;
}

let lastInspectionId: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let installed = false;

export function inspectionIdFromPath(pathname: string): string | null {
  const id = /^\/inspections\/([^/]+)/.exec(pathname)?.[1];
  return !id || id === "new" || id === "agent-notes" ? null : id;
}

/** A same-origin path, without its query, with anything token-shaped masked. */
export function routeOf(url: string): string {
  const path = new URL(url, window.location.origin).pathname;
  return path
    .split("/")
    .map((s) => (s.length > 40 ? ":token" : s.replace(/[^\w\-.:]/g, "_")))
    .join("/")
    .slice(0, 200);
}

function readBuffer(): FieldLogEvent[] {
  try {
    return JSON.parse(localStorage.getItem(BUFFER_KEY) ?? "[]") as FieldLogEvent[];
  } catch {
    return [];
  }
}

function writeBuffer(events: FieldLogEvent[]) {
  try {
    localStorage.setItem(BUFFER_KEY, JSON.stringify(events.slice(-MAX_BUFFERED)));
  } catch {
    // Storage full or blocked: the log is a diagnostic, never worth failing a tap for.
  }
}

export function isFieldLogOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) === "1";
  } catch {
    return false;
  }
}

export function setFieldLogOn(on: boolean) {
  try {
    if (on) localStorage.setItem(ON_KEY, "1");
    else {
      localStorage.removeItem(ON_KEY);
      localStorage.removeItem(BUFFER_KEY);
    }
  } catch {
    // As above.
  }
}

export function logFieldEvent(
  kind: Kind,
  name: string,
  extra: { route?: string; status?: number; note?: string } = {},
) {
  if (typeof window === "undefined" || !isFieldLogOn()) return;
  const inspectionId = inspectionIdFromPath(window.location.pathname) ?? lastInspectionId;
  if (!inspectionId) return;
  lastInspectionId = inspectionId;
  const event: FieldLogEvent = {
    id: crypto.randomUUID(),
    inspectionId,
    occurredAt: Date.now(),
    kind,
    name: name.replace(/[^\w.:-]/g, "_").slice(0, 64) || "unknown",
    ...extra,
  };
  writeBuffer([...readBuffer(), event]);
  if (!flushTimer) flushTimer = setTimeout(() => void flushFieldLog(), FLUSH_DELAY_MS);
}

/**
 * Sends the oldest batch. Rows leave the buffer only on an answer that retrying
 * cannot change: a 2xx, or a 4xx refusal, which would otherwise repeat forever.
 */
export async function flushFieldLog(send: typeof fetch = window.fetch) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (flushing || !navigator.onLine) return;
  const batch = readBuffer().slice(0, BATCH);
  if (batch.length === 0) return;
  flushing = true;
  try {
    const res = await send(FIELD_LOG_RESOURCE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
    if (res.status < 500 && res.status !== 401 && !res.redirected) {
      const sent = new Set(batch.map((e) => e.id));
      const rest = readBuffer().filter((e) => !sent.has(e.id));
      writeBuffer(rest);
      if (rest.length > 0) flushTimer = setTimeout(() => void flushFieldLog(send), 0);
    }
  } catch {
    // Still offline in practice. The buffer holds it for the next `online`.
  } finally {
    flushing = false;
  }
}

/** Wraps fetch and listens for connection, crash and backgrounding. Once per page. */
export function installFieldLog() {
  if (installed) return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const own = url.includes(FIELD_LOG_RESOURCE) || !sameOrigin(url);
    try {
      const res = await realFetch(input, init);
      if (!own && !res.ok) logFieldEvent("request_failed", method, { route: routeOf(url), status: res.status });
      return res;
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      if (!own && !aborted) logFieldEvent("request_failed", method, { route: routeOf(url) });
      throw error;
    }
  };
  window.addEventListener("online", () => {
    logFieldEvent("network", "online");
    void flushFieldLog(realFetch);
  });
  window.addEventListener("offline", () => logFieldEvent("network", "offline"));
  window.addEventListener("error", (e) => logFieldEvent("crash", errorName(e.error)));
  window.addEventListener("unhandledrejection", (e) => logFieldEvent("crash", errorName(e.reason)));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushFieldLog(realFetch);
  });
  void flushFieldLog(realFetch);
}

function sameOrigin(url: string): boolean {
  return new URL(url, window.location.origin).origin === window.location.origin;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown_error";
}
