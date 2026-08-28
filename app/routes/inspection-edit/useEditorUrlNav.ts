import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { nextItemTarget } from "~/lib/next-item";

/** Which screen of the phone drill-down stack is showing. */
export type EditorNavLevel = "sections" | "items" | "item";

export interface EditorUrlNavDeps {
    /** Only the phone shell drives the URL; the desktop rails keep their own state. */
    enabled: boolean;
    sections: Array<{ id: string }>;
    currentSectionIdx: number;
    activeItemId: string | null;
    setCurrentSectionIdx: (idx: number) => void;
    setActiveItemId: (id: string | null) => void;
}

export interface EditorUrlNav {
    level: EditorNavLevel;
    goToSection: (sectionId: string) => void;
    goToItem: (itemId: string) => void;
    /** Jump to an item in any section — one history entry. */
    goToItemIn: (sectionId: string, itemId: string) => void;
    /**
     * Walk forward to the next item in the REPORT, crossing section boundaries.
     * Null at the last item of the last section — the one place with nowhere to
     * go — so the control can disable itself rather than lie.
     */
    goNext: (() => void) | null;
    /** Up one level — pops real history where there is any to pop. */
    goUp: () => void;
    /** True when `goUp` from the section list leaves the editor entirely. */
    atRoot: boolean;
}

/**
 * The phone shell's drill-down stack, addressed by `?section=` and `?item=`.
 *
 * ── Why the URL and not component state ─────────────────────────────────────
 * Three things fall out of putting the stack in the URL that in-memory state
 * cannot give: Android's hardware back button walks sections → items → detail
 * instead of exiting the inspection; a link can address one item; and a reload
 * lands where the inspector was. That last one is not a nicety — launching the
 * camera backgrounds the browser, and a phone under memory pressure discards
 * the page while it is there. Coming back to the section list having lost your
 * place, mid-crawlspace, is the failure this prevents.
 *
 * ── Why search params and not nested routes ────────────────────────────────
 * A nested route owns a loader, and a loader is a network request. Tapping into
 * a section would then need the network — in the exact places (crawlspaces,
 * attics) where there is none. These params ride inside the route that is
 * already loaded, and `shouldRevalidate` refuses to refetch for them, so the
 * whole stack works offline once the editor is open.
 *
 * ── One direction only: the URL is the truth, state follows ────────────────
 * ⚠️ THIS WAS BIDIRECTIONAL ONCE AND IT RACED. The wrappers set component state
 * AND the URL, with an effect writing state back to the URL whenever they
 * drifted, the two gated apart by `useNavigationType()`. What that gating does
 * not cover is the commit BETWEEN them: the router's params update and
 * `activeItemId` do not necessarily land together, so there is a render where
 * the URL says `item=…` and state still says null — and the write-back effect,
 * seeing "state has no item", helpfully strips the param it had just set. The
 * e2e run caught it as a drill-down that reached the item screen with no `item`
 * in the URL, which is exactly the deep link and reload the params exist for.
 *
 * So: the wrappers write ONLY the URL, one effect makes state follow, and
 * `level` reads the URL rather than state. Back, forward, a cold deep link and
 * a reload are then all the same event — the params changed — with no second
 * writer to disagree with.
 *
 * The trade: a programmatic move that sets state WITHOUT going through a
 * wrapper (the publish gate jumping to a blocking defect) no longer restamps
 * the URL. Those paths are desktop-shaped, and a wrong URL is a far cheaper
 * failure than a stripped one — it self-corrects on the next tap.
 */
export function useEditorUrlNav({
    enabled,
    sections,
    currentSectionIdx,
    activeItemId,
    setCurrentSectionIdx,
    setActiveItemId,
}: EditorUrlNavDeps): EditorUrlNav {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    /**
     * How many stack entries THIS session pushed. `goUp` pops real history when
     * it can, so the back button and the on-screen back chevron agree; at zero
     * (someone opened a deep link cold) there is nothing to pop and it rewrites
     * the params instead of walking off the site.
     */
    const pushedDepth = useRef(0);

    const currentSectionId = sections[currentSectionIdx]?.id ?? null;

    /** Params this state would produce, as a plain record. */
    const paramsForState = useCallback(
        (sectionId: string | null, itemId: string | null) => {
            const next = new URLSearchParams(searchParams);
            if (sectionId) next.set("section", sectionId);
            else next.delete("section");
            if (itemId) next.set("item", itemId);
            else next.delete("item");
            return next;
        },
        [searchParams],
    );

    // ── The only sync: the URL changed, so state follows it. ─────────────────
    // Back, forward, a cold deep link and a reload all arrive here as the same
    // event. There is no writer in the other direction; see the docblock.
    useEffect(() => {
        if (!enabled) return;
        const urlSection = searchParams.get("section");
        const urlItem = searchParams.get("item");
        const idx = urlSection ? sections.findIndex((s) => s.id === urlSection) : -1;
        // An unresolvable section id (renamed template, stale link) is ignored
        // rather than reset — landing on a blank editor is worse than landing
        // on the section the editor already had.
        if (idx >= 0 && idx !== currentSectionIdx) setCurrentSectionIdx(idx);
        const nextItem = urlItem ?? null;
        if (nextItem !== activeItemId) setActiveItemId(nextItem);
        // `sections` is intentionally absent: it is the template's shape and does
        // not change while the editor is open, and including it would re-run this
        // on every results write (the array is rebuilt by useInspectionState).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, searchParams, currentSectionIdx, activeItemId, setCurrentSectionIdx, setActiveItemId]);

    // The wrappers write the URL and nothing else. State catches up through the
    // effect above — that is what keeps the two from disagreeing.
    const goToSection = useCallback(
        (sectionId: string) => {
            if (sections.findIndex((s) => s.id === sectionId) < 0) return;
            pushedDepth.current += 1;
            setSearchParams(paramsForState(sectionId, null), { preventScrollReset: true });
        },
        [sections, setSearchParams, paramsForState],
    );

    /**
     * Jump straight to an item in another section — what a search result is.
     *
     * One push, not a `goToSection` followed by a `goToItem`: two entries would
     * make the back button land on the target's section list, a screen the
     * inspector never chose to be on and did not come from.
     */
    const goToItemIn = useCallback(
        (sectionId: string, itemId: string) => {
            if (sections.findIndex((s) => s.id === sectionId) < 0) return;
            pushedDepth.current += 1;
            setSearchParams(paramsForState(sectionId, itemId), { preventScrollReset: true });
        },
        [sections, setSearchParams, paramsForState],
    );

    const goToItem = useCallback(
        (itemId: string) => {
            pushedDepth.current += 1;
            setSearchParams(paramsForState(currentSectionId, itemId), { preventScrollReset: true });
        },
        [currentSectionId, setSearchParams, paramsForState],
    );

    // The forward walk lives here with the rest of the navigation rather than in
    // the route: this hook already knows the sections and where the inspector
    // is, and "next" is a move like any other.
    const next = nextItemTarget(sections as never, currentSectionId, activeItemId);
    const goNext = next ? () => goToItemIn(next.sectionId, next.itemId) : null;

    // Derived from the URL, not from state: the screen must match the address
    // bar on the render the params land, not one commit later.
    const level: EditorNavLevel = searchParams.get("item")
        ? "item"
        : searchParams.get("section")
            ? "items"
            : "sections";
    const atRoot = level === "sections";

    const goUp = useCallback(() => {
        if (pushedDepth.current > 0) {
            pushedDepth.current -= 1;
            void navigate(-1);
            return;
        }
        // Cold deep link: no entry of ours to pop, so rewrite one level up.
        if (searchParams.get("item")) {
            setSearchParams(paramsForState(currentSectionId, null), { replace: true, preventScrollReset: true });
            return;
        }
        if (searchParams.get("section")) {
            setSearchParams(paramsForState(null, null), { replace: true, preventScrollReset: true });
            return;
        }
        void navigate("/inspections");
    }, [currentSectionId, navigate, searchParams, setSearchParams, paramsForState]);

    return { level, goToSection, goToItem, goToItemIn, goNext, goUp, atRoot };
}
