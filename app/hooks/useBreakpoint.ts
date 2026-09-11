import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 767.98px)';

function subscribe(onChange: () => void) {
    const mq = window.matchMedia(QUERY);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
}
function getSnapshot() {
    return window.matchMedia(QUERY).matches;
}
// The server has no viewport, so it renders the desktop tree. Hydration has to
// produce that same tree or React throws #418 and rebuilds the page from
// scratch — which is what a `useState(() => matchMedia(...).matches)` seed did
// on every phone. A fixed server snapshot lets React hydrate cleanly and then
// re-render once with the real value.
function getServerSnapshot() {
    return false;
}

/**
 * Returns true when viewport is below the Tailwind `md` breakpoint (768px).
 * Uses matchMedia for efficient subscription; re-renders on viewport changes.
 */
export function useIsMobile(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
