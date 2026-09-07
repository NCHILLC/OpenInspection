/**
 * The params the phone report writer's drill-down stack walks with.
 *
 * Shared rather than copied because TWO routes have to agree about them: the
 * editor route, whose loader is heavy, and the ROOT route, whose loader is
 * cheap but still a server round trip on every client navigation. A drill-down
 * that skips one and not the other still hits the network once per tap, which
 * is the thing the stack exists to avoid — see `useEditorUrlNav`.
 */
const NAV_ONLY_PARAMS = new Set(["section", "item"]);

/**
 * True when two URLs differ ONLY in the drill-down params.
 *
 * Deliberately a whitelist of those two keys rather than "any param changed":
 * a future param that genuinely selects different data must still revalidate,
 * and will, because it is not in the set.
 */
export function isDrilldownOnlyChange(currentUrl: URL, nextUrl: URL): boolean {
    // An IDENTICAL url is not a drill-down change, it is not a change at all.
    // React Router passes the same URL as both current and next for an explicit
    // `revalidator.revalidate()`, and the loop below finds no differing param
    // and returns true for it — so every caller read "same URL" as
    // "drilldown-only" and skipped the revalidation. That silently made every
    // explicit revalidate() in the editor a no-op: the units drawer never
    // showed a unit the server had already created (200 on POST .../units), and
    // the offline-sync refresh `should-revalidate` documents as still working
    // did not. Answer the question actually being asked before walking params.
    if (currentUrl.href === nextUrl.href) return false;
    if (currentUrl.pathname !== nextUrl.pathname) return false;
    const keys = new Set([...currentUrl.searchParams.keys(), ...nextUrl.searchParams.keys()]);
    for (const key of keys) {
        if (NAV_ONLY_PARAMS.has(key)) continue;
        if (currentUrl.searchParams.get(key) !== nextUrl.searchParams.get(key)) return false;
    }
    return true;
}
