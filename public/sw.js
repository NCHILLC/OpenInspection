// OpenInspection Service Worker
//
// Two caches, kept apart on purpose:
//
//   STATIC_CACHE  Same for every visitor: CSS/JS/images/manifest. Cache-first, refreshed in the
//                 background. Nothing in it depends on who is signed in.
//
//   USER_CACHE    Everything that depends on the signed-in user, so it can work offline for THAT user
//                 and for nobody else:
//                   - inspection photo files (/api/inspections/files/*)
//                   - HTML pages (the server-rendered document embeds the viewer's data)
//                 Every entry is stamped with the opaque session marker it was stored under
//                 (`x-oi-user`) and is served only to the SAME marker. The marker is learned from the
//                 page (`set-user` message) and from the `x-oi-session` header the server puts on
//                 document responses that carry a session.
//                 With no known user nothing is read from, or written to, this cache (fail closed).
//
// Every other /api/* request is network-only (offline is IndexedDB + the photo queue, never an HTTP
// cache). Unlike upstream, this worker has no cached inspection read at all; see the fetch handler.
//
// Messages from the page:
//   { type: 'set-user', marker: string | null }  who is signed in now (null: nobody). A change purges USER_CACHE.
//   { type: 'clear-user-cache' }                 purge USER_CACHE and forget the user (sign-out).
//   { type: 'queue-changed' }                    register the background sync.

const SW_VERSION   = 'v4-a1';
const STATIC_CACHE = `openinspection-static-${SW_VERSION}`;
const USER_CACHE   = `openinspection-user-${SW_VERSION}`;
const META_CACHE   = `openinspection-meta-${SW_VERSION}`;
const KEEP_CACHES  = [STATIC_CACHE, USER_CACHE, META_CACHE];

const MARKER_URL   = `${self.location.origin}/__oi/user-marker`;
const USER_HEADER  = 'x-oi-user';
const SESSION_HEADER = 'x-oi-session';

const PRECACHE_ASSETS = [
  '/favicon.svg',
  '/logo.svg',
  '/manifest.json',
];

const CDN_HOSTS = [];

const PHOTO_FILE_PREFIX = '/api/inspections/files/';
const LOGOUT_PATHS = ['/logout', '/agent-logout'];

// -- Install: precache the static shell ---------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Tolerant precache: a single 404 must not brick the whole install
      // ('/styles.css' did exactly that after the single-worker flatten).
      Promise.allSettled(PRECACHE_ASSETS.map((a) => cache.add(a)))
    )
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// -- Activate: purge every cache of an earlier version ------------------------------------------
// This is what removes the shared, user-blind cache that older versions wrote.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all open clients immediately
  self.clients.claim();
  self.clients.matchAll().then(clients => {
    clients.forEach(c => c.postMessage({ type: 'sw-updated', version: SW_VERSION }));
  });
});

// -- Who is signed in ---------------------------------------------------------------------------
// The marker lives in a Cache entry, not in a variable: a worker is stopped and restarted all the
// time, and a variable would forget the user exactly when the page is offline.
async function readMarker() {
  try {
    const cache = await caches.open(META_CACHE);
    const hit = await cache.match(MARKER_URL);
    const text = hit ? await hit.text() : '';
    return text || null;
  } catch {
    return null;
  }
}

async function writeMarker(marker) {
  const cache = await caches.open(META_CACHE);
  if (marker) await cache.put(MARKER_URL, new Response(marker));
  else await cache.delete(MARKER_URL);
}

async function clearUserCache() {
  await writeMarker(null);
  await caches.delete(USER_CACHE);
}

// Record who is signed in. A different user (or nobody) means every USER_CACHE entry belongs to someone else.
async function setUser(marker) {
  const next = typeof marker === 'string' && marker.length > 0 && marker.length <= 128 ? marker : null;
  const current = await readMarker();
  if (current === next) return;
  await writeMarker(next);
  await caches.delete(USER_CACHE);
}

// -- Fetch --------------------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && url.pathname.startsWith('/api/')) {
    // Photo files served from R2 via our API: keys are UUIDs and immutable, but who may read one is
    // not, so they are cached per user like everything else that depends on access.
    if (url.pathname.startsWith(PHOTO_FILE_PREFIX)) {
      event.respondWith(userCacheFirst(event, request));
    }
    // Every other API call: network-only. Offline is served by IndexedDB (field
    // data is a Yjs doc) and the photo queue, never from an HTTP cache — a cached
    // API read is a stale answer presented as a current one.
    //
    // A cache-first branch for `/api/inspections/:id` and `/:id/results` used to
    // live here. It never fired: loaders reach the API in-process over the
    // API_WORKER binding, so the browser issues no such request. What it did do
    // was match `dashboard`, `templates`, `counts`, `inspectors` and
    // `schedule-conflicts` too — `[^/]+` does not know an id from a route name.
    // Upstream kept a UUID-only version of it in the per-user cache; this fork
    // does not, so do not add one back. See tests/unit/pwa/sw-offline-navigation.spec.ts.
    return;
  }

  // Static assets on our origin: stale-while-revalidate
  const isStaticAsset =
    sameOrigin &&
    (url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.jpeg') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.webp') ||
      url.pathname === '/manifest.json');

  if (isStaticAsset) {
    event.respondWith(staticCacheFirst(event, request));
    return;
  }

  // CDN assets (Alpine.js, Google Fonts): cache-first, fetch & store on miss
  const isCdnAsset = CDN_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
  if (isCdnAsset) {
    event.respondWith(staticCacheFirst(event, request));
    return;
  }

  // HTML navigation: network-first, serve this user's cached page on failure
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithCacheFallback(request, url));
    return;
  }
});

// -- Helpers ------------------------------------------------------------------------------------

async function staticCacheFirst(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  // Refresh in the background even when serving from cache
  const refresh = fetch(request).then((response) => {
    if (response.ok && response.status === 200) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

// Store a copy stamped with the marker it was fetched under.
async function putForUser(request, response, marker) {
  const headers = new Headers(response.headers);
  headers.set(USER_HEADER, marker);
  const stamped = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await caches.open(USER_CACHE);
  await cache.put(request, stamped);
}

// Store for this user if they are still the one signed in. A failed write (storage quota, a response
// the Cache API refuses) must never cost the caller a response the network already delivered.
async function storeIfStillCurrent(request, response, marker) {
  try {
    if ((await readMarker()) === marker) await putForUser(request, response, marker);
  } catch {
    // Not cached; the live response is still returned by the caller.
  }
}

// A cached entry for exactly this user, or null. An entry stamped for anyone else is removed.
async function cachedForUser(request, marker, matchOptions) {
  const cache = await caches.open(USER_CACHE);
  const hit = await cache.match(request, matchOptions);
  if (!hit) return null;
  if (hit.headers.get(USER_HEADER) === marker) return hit;
  await cache.delete(request, matchOptions);
  return null;
}

async function userCacheFirst(event, request) {
  const marker = await readMarker();
  // Nobody known: behave as if this cache did not exist.
  if (!marker) return fetch(request);

  const cached = await cachedForUser(request, marker);

  const refresh = (async () => {
    let response;
    try {
      response = await fetch(request);
    } catch {
      return null;
    }
    // Copy now: the body can be read once, and the caller gets the original.
    const copy = response.ok && response.status === 200 ? response.clone() : null;
    if (copy) {
      // Sign-out or a different user may have happened while this was in flight.
      await storeIfStillCurrent(request, copy, marker);
    } else if (response.status === 401 || response.status === 403 || response.status === 404) {
      // The server no longer lets this user read it: forget our copy.
      const cache = await caches.open(USER_CACHE);
      await cache.delete(request);
    }
    return response;
  })();

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

async function networkFirstWithCacheFallback(request, url) {
  // Leaving the session: drop the user's cache before the request goes out.
  if (LOGOUT_PATHS.includes(url.pathname)) await clearUserCache();

  try {
    const response = await fetch(request);
    const type = response.headers.get('content-type') || '';
    // The server stamps a document requested with a session with an opaque marker of that user, so a
    // landing page (SSO, an invite link, a bookmark) tells the worker who is looking before any script
    // runs. No header means "not told", not "signed out": nothing changes and the page is not stored.
    // Sign-out is announced by the page (set-user null) and by /logout above.
    const marker = response.headers.get(SESSION_HEADER);
    if (marker && response.status === 200 && type.includes('text/html')) {
      try {
        await setUser(marker);
      } catch {
        // The marker could not be saved: nothing is stored below either, since the check reads it back.
      }
      await storeIfStillCurrent(request, response.clone(), marker);
    }
    return response;
  } catch {
    const marker = await readMarker();
    // ⚠️ THE SECOND MATCH IS THE ONE THAT SAVES A CRAWLSPACE SESSION.
    // `cache.match` keys on the FULL url, query string included, and the phone
    // editor drills down via search params (`?section=&item=` — the D3 nav
    // decision) using client-side routing, which issues no navigation request
    // and therefore caches nothing. So the only document ever cached is the
    // bare URL the inspector arrived on, and an offline reload three taps deep
    // asked for `…/edit?section=X&item=Y`, missed, and got the 503 below —
    // a dead page, with the whole inspection sitting intact in IndexedDB.
    // `ignoreSearch` serves that same route's cached document; the app rehydrates
    // from local state and the address bar still holds the real params.
    const cached = marker
      ? (await cachedForUser(request, marker)) ?? (await cachedForUser(request, marker, { ignoreSearch: true }))
      : null;
    // ⚠️ `charset=utf-8` is load-bearing. A response with no charset is decoded
    // with the browser's legacy default — which rendered the em-dash this page
    // used to carry as "Offline 钦� please reconnect to continue." on a machine
    // with a CJK locale. Found by reading the offline page in a browser;
    // nothing in the source looked wrong.
    return cached || new Response(await offlinePage(marker), {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

// What an offline navigation gets when nothing is cached for its route.
//
// Self-contained on purpose: no stylesheet, script file or image, because each
// of those is one more request that can miss. The list is what makes this a way
// back instead of a dead end — field data lives in IndexedDB, but only a route
// whose DOCUMENT is cached can boot the app that reads it, so those are the
// routes worth offering. The editor's <title> is the same for every inspection,
// hence the "opened" time as the only label that tells two of them apart.
//
// Only the signed-in user's own pages are listed: another user's documents in the same browser are
// never offered, and with no known user the list is empty.
async function offlinePage(marker) {
  const links = [];
  if (marker) {
    const cache = await caches.open(USER_CACHE);
    const seen = new Set();
    for (const req of await cache.keys()) {
      const { pathname } = new URL(req.url);
      if (!/^\/inspections\/[^/]+\/edit$/.test(pathname) || seen.has(pathname)) continue;
      const entry = await cache.match(req);
      if (entry?.headers.get(USER_HEADER) !== marker) continue;
      seen.add(pathname);
      const opened = entry.headers.get('date');
      const label = opened ? `Inspection opened ${new Date(opened).toLocaleString()}` : 'Open inspection';
      // `pathname` comes out of the URL parser already percent-encoded.
      links.push(`<li><a href="${pathname}">${label}</a></li>`);
    }
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; font: 16px/1.5 system-ui, sans-serif; }
main { width: 100%; max-width: 26rem; }
h1 { margin: 0 0 8px; font-size: 22px; }
h2 { margin: 28px 0 8px; font-size: 16px; }
p { margin: 0 0 20px; }
ul { margin: 0; padding: 0; list-style: none; }
button, a { display: flex; align-items: center; min-height: 44px; box-sizing: border-box; font: inherit; }
button { width: 100%; justify-content: center; padding: 0 16px; border: 0; border-radius: 8px; background: #4f46e5; color: #fff; font-weight: 700; }
a { padding: 0 4px; color: inherit; border-top: 1px solid rgba(128, 128, 128, 0.35); }
</style>
</head>
<body>
<main>
<h1>You're offline</h1>
<p>This page isn't saved on this device. Work already entered in an inspection is kept on this device and syncs when the connection returns.</p>
<button type="button" onclick="location.reload()">Try again</button>
${links.length ? `<h2>Inspections saved on this device</h2><ul>${links.join('')}</ul>` : ''}
</main>
<script>addEventListener('online', function () { location.reload(); });</script>
</body>
</html>`;
}

// -- Messages and Background Sync ---------------------------------------------------------------
// (Background sync: Chromium only; iOS Safari throws on register.)
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'queue-changed') {
    try {
      self.registration.sync?.register('oi-sync');
    } catch { /* iOS Safari has no SyncManager */ }
  } else if (data.type === 'set-user') {
    event.waitUntil(setUser(data.marker));
  } else if (data.type === 'clear-user-cache') {
    event.waitUntil(clearUserCache());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'oi-sync') return;
  event.waitUntil((async () => {
    // Cannot import ES modules into a classic SW — open a client to drive it
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    if (clients[0]) clients[0].postMessage({ type: 'drain-queue' });
  })());
});
