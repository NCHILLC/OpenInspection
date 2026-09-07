import { describe, it, expect } from "vitest";
import { isDrilldownOnlyChange, shouldRevalidate } from "./should-revalidate";

const url = (s: string) => new URL(s, "https://example.test");

describe("isDrilldownOnlyChange", () => {
    // The regression this predicate shipped with: an explicit
    // revalidator.revalidate() hands React Router the SAME url twice, the param
    // loop found nothing different, and every caller skipped the revalidation.
    // A unit created server-side never appeared in the drawer.
    it("is false when the url has not changed at all", () => {
        expect(isDrilldownOnlyChange(url("/inspections/1/edit"), url("/inspections/1/edit"))).toBe(false);
        expect(
            isDrilldownOnlyChange(url("/inspections/1/edit?section=s2"), url("/inspections/1/edit?section=s2")),
        ).toBe(false);
    });

    it("revalidates an explicit same-url revalidate", () => {
        const same = url("/inspections/1/edit?section=s2&item=i9");
        expect(shouldRevalidate({ currentUrl: same, nextUrl: same, defaultShouldRevalidate: true })).toBe(true);
    });

    it("is true when only the section param moves", () => {
        expect(isDrilldownOnlyChange(url("/inspections/1/edit"), url("/inspections/1/edit?section=s2"))).toBe(true);
    });

    it("is true when only the item param moves", () => {
        expect(
            isDrilldownOnlyChange(url("/inspections/1/edit?section=s2"), url("/inspections/1/edit?section=s2&item=i9")),
        ).toBe(true);
    });

    it("is true when drilling back up drops both", () => {
        expect(
            isDrilldownOnlyChange(url("/inspections/1/edit?section=s2&item=i9"), url("/inspections/1/edit")),
        ).toBe(true);
    });

    it("is FALSE when the path changes — a different inspection is different data", () => {
        expect(
            isDrilldownOnlyChange(url("/inspections/1/edit?section=s2"), url("/inspections/2/edit?section=s2")),
        ).toBe(false);
    });

    // The whitelist earns its keep here: a param that genuinely selects other
    // data must still refetch, and does, because it is not one of the two.
    it("is FALSE when a non-nav param changes alongside the nav params", () => {
        expect(
            isDrilldownOnlyChange(
                url("/inspections/1/edit?section=s2&unit=u1"),
                url("/inspections/1/edit?section=s3&unit=u2"),
            ),
        ).toBe(false);
    });

    it("is FALSE when a non-nav param appears", () => {
        expect(isDrilldownOnlyChange(url("/inspections/1/edit"), url("/inspections/1/edit?unit=u1"))).toBe(false);
    });
});

describe("shouldRevalidate", () => {
    it("refuses to revalidate a POST — the editor persists through fetchers", () => {
        expect(shouldRevalidate({ formMethod: "POST", defaultShouldRevalidate: true })).toBe(false);
        expect(shouldRevalidate({ formMethod: "post", defaultShouldRevalidate: true })).toBe(false);
    });

    // The point of the whole module: one tap into a section must not re-run the
    // inspection loader, because the inspector may have no signal to serve it.
    it("refuses to revalidate a drill-down tap", () => {
        expect(
            shouldRevalidate({
                currentUrl: url("/inspections/1/edit"),
                nextUrl: url("/inspections/1/edit?section=s2"),
                defaultShouldRevalidate: true,
            }),
        ).toBe(false);
    });

    it("still revalidates a genuine navigation", () => {
        expect(
            shouldRevalidate({
                currentUrl: url("/inspections/1/edit"),
                nextUrl: url("/inspections/2/edit"),
                defaultShouldRevalidate: true,
            }),
        ).toBe(true);
    });

    it("defers to the default when no URLs are supplied", () => {
        expect(shouldRevalidate({ defaultShouldRevalidate: true })).toBe(true);
        expect(shouldRevalidate({ defaultShouldRevalidate: false })).toBe(false);
    });
});
