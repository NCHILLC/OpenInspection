// OpenInspection Service Worker
// Strategy:
//   - Static assets (CSS/JS/images/manifest): cache-first, update in background
//   - CDN assets (fonts): cache-first on first fetch
//   - HTML navigation: network-first, fall back to cache for offline shell
//   - /api/inspections/files/* (photo bytes, immutable keys): cache-first
//   - every other /api/* request: network-only (offline is IndexedDB + the
//     photo queue, never an HTTP cache)

const SW_VERSION  = 'v3-a2';
const CACHE_NAME  = `openinspection-${SW_VERSION}`;

const PRECACHE_ASSETS = [
  '/favicon.svg',
  '/logo.svg',
  '/manifest.json',
];

const CDN_HOSTS = [];

// ���� Install: precache static shell ������������������������������������������������������������������������������������
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Tolerant precache: a single 404 must not brick the whole install
      // ('/styles.css' did exactly that after the single-worker flatten).
      Promise.allSettled(PRECACHE_ASSETS.map((a) => cache.add(a)))
    )
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ���� Activate: purge stale caches ����������������������������������������������������������������������������������������
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all open clients immediately
  self.clients.claim();
  self.clients.matchAll().then(clients => {
    clients.forEach(c => c.postMessage({ type: 'sw-updated', version: SW_VERSION }));
  });
});

// ���� Fetch ����������������������������������������������������������������������������������������������������������������������������������������
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Photo files served from R2 via our API — cache-first (keys are UUIDs, immutable)
  if (url.pathname.startsWith('/api/inspections/files/')) {
    event.respondWith(cacheFirstWithRefresh(request));
    return;
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
  // See tests/unit/pwa/sw-offline-navigation.spec.ts.
  if (url.pathname.startsWith('/api/')) return;

  // Static assets on our origin: stale-while-revalidate
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.jpeg') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.webp') ||
      url.pathname === '/manifest.json');

  if (isStaticAsset) {
    event.respondWith(cacheFirstWithRefresh(request));
    return;
  }

  // CDN assets (Alpine.js, Google Fonts): cache-first, fetch & store on miss
  const isCdnAsset = CDN_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
  if (isCdnAsset) {
    event.respondWith(cacheFirstWithRefresh(request));
    return;
  }

  // HTML navigation: network-first, serve cached shell on failure
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }
});

// ���� Helpers ��������������������������������������������������������������������������������������������������������������������������������������

async function cacheFirstWithRefresh(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Refresh in the background even when serving from cache
  const networkFetch = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || (await networkFetch);
}

async function networkFirstWithCacheFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
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
    const cached =
      (await cache.match(request)) ?? (await cache.match(request, { ignoreSearch: true }));
    // ⚠️ `charset=utf-8` is load-bearing. A response with no charset is decoded
    // with the browser's legacy default — which rendered the em-dash this page
    // used to carry as "Offline 钦� please reconnect to continue." on a machine
    // with a CJK locale. Found by reading the offline page in a browser;
    // nothing in the source looked wrong.
    return cached || new Response(await offlinePage(cache), {
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
async function offlinePage(cache) {
  const links = [];
  const seen = new Set();
  for (const req of await cache.keys()) {
    const { pathname } = new URL(req.url);
    if (!/^\/inspections\/[^/]+\/edit$/.test(pathname) || seen.has(pathname)) continue;
    seen.add(pathname);
    const opened = (await cache.match(req))?.headers.get('date');
    const label = opened ? `Inspection opened ${new Date(opened).toLocaleString()}` : 'Open inspection';
    // `pathname` comes out of the URL parser already percent-encoded.
    links.push(`<li><a href="${pathname}">${label}</a></li>`);
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

// ── Background Sync (Chromium only — iOS Safari throws on register) ─────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'queue-changed') {
    try {
      self.registration.sync?.register('oi-sync');
    } catch { /* iOS Safari has no SyncManager */ }
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
