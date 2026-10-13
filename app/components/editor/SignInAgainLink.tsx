import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { m } from "~/paraglide/messages";

/**
 * The way back in when the session ended under an open editor.
 *
 * `returnTo` is this page with its `?section=`/`?item=`, so logging in lands on
 * the finding being written rather than on the inspection list. It is a plain
 * anchor, not a `<Link>`: the cookies change underneath the page, and a full
 * document load is the one navigation that cannot carry stale state across.
 *
 * The padding with its equal negative margin makes the tap target at least
 * 44px tall (an 18px line plus 2 x 14px) without moving the 24px pill it sits in.
 */
export function SignInAgainLink({ children }: { children: ReactNode }) {
    const { pathname, search } = useLocation();
    return (
        <a
            href={`/login?returnTo=${encodeURIComponent(pathname + search)}`}
            title={m.editor_session_expired()}
            className="underline py-3.5 -my-3.5"
        >
            {children}
        </a>
    );
}
