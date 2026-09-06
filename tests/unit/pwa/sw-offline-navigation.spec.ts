/**
 * `public/sw.js` — the offline navigation fallback.
 *
 * The 2026-09-06 field-eval P0: reloading the editor offline served the SW's
 * plain-text "Offline — please reconnect", ending the session, while the whole
 * inspection sat intact in IndexedDB.
 *
 * The cause was not that navigations go uncached — they are cached, on the way
 * out. It is that `cache.match` keys on the FULL url. The phone editor drills
 * down through `?section=&item=` search params using client-side routing, which
 * issues no navigation request and so caches nothing; the only document ever
 * cached is the bare URL the inspector arrived on. Reload three taps deep and
 * the lookup misses by exactly its query string.
 *
 * There is no build step for the service worker and no other harness for it, so
 * this drives the real file: read the source, run it in a `vm` context with a
 * stub `self`/`caches`/`fetch`, and call the captured fetch handler.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

type Handler = (event: { request: Request; respondWith: (r: unknown) => void }) => void;

/** The bare minimum of the CacheStorage API that sw.js touches. */
class FakeCache {
    entries = new Map<string, Response>();

    put(request: Request | string, response: Response): Promise<void> {
        this.entries.set(typeof request === 'string' ? request : request.url, response);
        return Promise.resolve();
    }

    /** Mirrors the real `ignoreSearch` semantics: compare urls without the query. */
    match(request: Request | string, opts?: { ignoreSearch?: boolean }): Promise<Response | undefined> {
        const url = typeof request === 'string' ? request : request.url;
        if (!opts?.ignoreSearch) return Promise.resolve(this.entries.get(url));
        const bare = (u: string): string => u.split('?')[0];
        for (const [k, v] of this.entries) {
            if (bare(k) === bare(url)) return Promise.resolve(v);
        }
        return Promise.resolve(undefined);
    }

    add(): Promise<void> {
        return Promise.resolve();
    }
}

let cache: FakeCache;
let online: boolean;
let fetchHandler: Handler;

/** Load public/sw.js into a fresh vm context and return its `fetch` handler. */
function loadServiceWorker(): Handler {
    const source = readFileSync(resolve('public/sw.js'), 'utf8');
    const handlers = new Map<string, Handler>();
    const self = {
        addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
        skipWaiting: () => {},
        clients: { claim: () => {}, matchAll: () => Promise.resolve([]) },
        location: { origin: 'https://app.test' },
        registration: { sync: { register: () => Promise.resolve() } },
    };
    const context = createContext({
        self,
        caches: {
            open: () => Promise.resolve(cache),
            keys: () => Promise.resolve([]),
            delete: () => Promise.resolve(true),
        },
        // Offline is a rejected fetch, which is what a dead network actually does.
        fetch: () => (online ? Promise.resolve(new Response('<html>editor</html>', { status: 200 })) : Promise.reject(new Error('offline'))),
        Response,
        Request,
        URL,
        Promise,
    });
    runInContext(source, context);
    const handler = handlers.get('fetch');
    if (!handler) throw new Error('sw.js registered no fetch handler');
    return handler;
}

/**
 * Drive one navigation through the worker and return what it answered.
 *
 * A plain object, not a real `Request`: the fetch spec forbids constructing one
 * with `mode: 'navigate'` (only a browser may), and sw.js reads nothing beyond
 * these three fields before handing the object to fetch / cache.
 */
async function navigate(url: string): Promise<Response> {
    const request = { method: 'GET', url, mode: 'navigate' } as unknown as Request;
    let answered: Promise<Response> | undefined;
    fetchHandler({ request, respondWith: (r) => { answered = r as Promise<Response>; } });
    if (!answered) throw new Error('the worker did not respond to a navigation');
    return answered;
}

const EDITOR = 'https://app.test/inspections/42/edit';

beforeEach(() => {
    cache = new FakeCache();
    online = true;
    fetchHandler = loadServiceWorker();
});

describe('sw.js — an offline reload must not end the inspection', () => {
    it('caches a navigation while online', async () => {
        await navigate(EDITOR);
        expect(await cache.match(EDITOR)).toBeDefined();
    });

    it('serves the cached document when the exact url is reloaded offline', async () => {
        await navigate(EDITOR);
        online = false;
        const res = await navigate(EDITOR);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('editor');
    });

    /**
     * THE P0. The inspector arrived at the bare editor url online, drilled into
     * a section and an item client-side (caching nothing), then reloaded in a
     * crawlspace. Before the fix this returned the 503 text below.
     */
    it('serves the cached document for a drill-down url it never saw online', async () => {
        await navigate(EDITOR);
        online = false;
        const res = await navigate(`${EDITOR}?section=roof&item=flashing`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('editor');
    });

    it('still refuses honestly when nothing for that route was ever cached', async () => {
        online = false;
        const res = await navigate('https://app.test/some/other/route');
        expect(res.status).toBe(503);
        expect(await res.text()).toContain('Offline');
    });
});
