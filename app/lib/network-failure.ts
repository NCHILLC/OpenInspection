/**
 * True when `error` means the request never reached a server: the browser's
 * "Failed to fetch" family (Chrome, Safari "Load failed", Firefox "NetworkError"),
 * or any error at all while the browser reports it is offline. The second arm is
 * what catches a dynamic import of an uncached chunk, whose TypeError text
 * differs per engine. A 4xx/5xx is a Response, not this.
 */
const FETCH_FAILURE = /failed to fetch|load failed|networkerror/i;

export function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof TypeError && FETCH_FAILURE.test(error.message);
}
