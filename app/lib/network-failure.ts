/**
 * True when `error` means the request never reached a server: the browser's
 * "Failed to fetch" family (Chrome, Safari "Load failed", Firefox "NetworkError"),
 * or any error at all while the browser reports it is offline. The second arm is
 * what catches a dynamic import of an uncached chunk, whose TypeError text
 * differs per engine. A 4xx/5xx is a Response, not this.
 */
const FETCH_FAILURE = /failed to fetch|load failed|networkerror/i;

/**
 * True only when the browser KNOWS it has no connection. `onLine === true` can be
 * wrong (a phone with a bar of signal and no route), `false` cannot, so this is
 * a "skip the request" test and never a "the request will work" test.
 */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isNetworkFailure(error: unknown): boolean {
  if (isOffline()) return true;
  return error instanceof TypeError && FETCH_FAILURE.test(error.message);
}
