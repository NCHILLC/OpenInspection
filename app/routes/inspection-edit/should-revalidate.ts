import { isDrilldownOnlyChange } from "~/lib/drilldown-nav";

// Re-exported so this module's tests, which own the predicate's cases, keep
// addressing it here alongside the policy that consumes it.
export { isDrilldownOnlyChange };

/**
 * The editor holds its own optimistic state (useInspection) and persists every
 * change through fetchers. Re-running this heavy loader after each mutation
 * (rate / notes / save-settings / set-cover / upload-cover …) just reloads and
 * flickers the whole editor. Skip revalidation for POST submissions; navigation
 * and explicit `revalidator.revalidate()` (offline sync) still refresh because
 * they carry no POST formMethod.
 *
 * ⚠️ `?section=`/`?item=` ARE NAVIGATION WITHIN ONE EDITOR, NOT A NEW PAGE. The
 * phone shell walks sections → items → item detail by writing those two params
 * (see `useEditorUrlNav`), which makes every tap a navigation React Router
 * would revalidate by default — re-running the whole inspection loader once per
 * tap. That is a network round trip for data the editor already holds, and
 * inspectors work in crawlspaces and attics where there is no signal to serve
 * it. Same path plus a params-only diff on those two keys ⇒ do not refetch.
 *
 * The check is deliberately a WHITELIST of the two nav params rather than a
 * blanket "params changed ⇒ skip": a future param that genuinely selects
 * different data must still refetch, and would, because it is not in the set.
 */
export function shouldRevalidate({
    currentUrl,
    nextUrl,
    formMethod,
    defaultShouldRevalidate,
}: {
    currentUrl?: URL;
    nextUrl?: URL;
    formMethod?: string;
    defaultShouldRevalidate: boolean;
}) {
    if (formMethod && formMethod.toUpperCase() === "POST") return false;
    if (currentUrl && nextUrl && isDrilldownOnlyChange(currentUrl, nextUrl)) return false;
    return defaultShouldRevalidate;
}
