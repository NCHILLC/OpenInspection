// @vitest-environment happy-dom
/**
 * Workspace editor preferences.
 *
 * IA-129 — a failed save must not stand. `patch()` updates optimistically, and
 * the only effect consuming the response handled `ok === true`. There was no
 * else. A failed save therefore left the control showing the value that had
 * just failed to save, said nothing, and reverted invisibly on the next page
 * load — so an operator believed they had changed how every inspector's editor
 * behaves. Silence is wrong twice here: it also left the page with no
 * vocabulary for success, so a failure had nothing to be contrasted against.
 *
 * Offline — a refused load must not kill the page. The load used to go through
 * a React Router fetcher, and a fetcher whose request fails hands the error to
 * the route's ErrorBoundary: an offline reload of the editor, the one state it
 * promises to survive, rendered "Something went wrong" over an inspection
 * sitting intact in IndexedDB. The load is a plain fetch now, and a refusal is
 * the documented fallback: DEFAULTS, and `loaded`.
 *
 * A note on the harness, because the first version of this file was useless: it
 * called a fresh `render()` to observe the "after" state, which mounts a NEW
 * hook whose refs and state start empty — so it could never see a rollback, and
 * all five tests passed with the fix deleted. The rollback only exists ACROSS
 * RENDERS OF ONE INSTANCE, so the harness has to re-render the same component
 * and read the same hook. That is what `bump()` below is for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

import { useInspectionPrefs } from "~/hooks/useInspectionPrefs";

// The hook owns one fetcher (patch). The load is a plain fetch, stubbed below.
let patchState: "idle" | "submitting" = "idle";
let patchData: unknown = undefined;
const submit = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useFetcher: vi.fn(() => ({
      get state() { return patchState; },
      get data() { return patchData; },
      load: vi.fn(),
      submit,
      Form: (): null => null,
    })),
  };
});

/** What the resource route answers. Default: the connection is refused. */
let loadResponse: () => Promise<Response> = () => Promise.reject(new TypeError("Failed to fetch"));
const fetchMock = vi.fn(() => loadResponse());
const respond = (body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

type Hook = ReturnType<typeof useInspectionPrefs>;

function harness() {
  const seen: Hook[] = [];
  function Probe({ tick }: { tick: number }) {
    seen.push(useInspectionPrefs());
    return <span data-testid="tick">{tick}</span>;
  }
  let tick = 0;
  const { rerender } = render(<Probe tick={tick} />);
  return {
    latest: () => seen[seen.length - 1],
    /** Re-render the SAME component so effects re-run against the same hook. */
    bump: () => act(() => { rerender(<Probe tick={++tick} />); }),
  };
}

beforeEach(() => {
  patchState = "idle";
  patchData = undefined;
  submit.mockClear();
  fetchMock.mockClear();
  loadResponse = () => Promise.reject(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("useInspectionPrefs — IA-130: defaults are not an answer", () => {
  it("serves DEFAULTS and loaded:false together, so callers can tell", () => {
    loadResponse = () => new Promise(() => {}); // still in flight
    const h = harness();
    expect(h.latest().loaded).toBe(false);
    expect(h.latest().prefs.autoAdvance).toBe("always");
  });

  it("only claims loaded once real prefs land", async () => {
    loadResponse = respond({ prefs: { autoAdvance: "off" } });
    const h = harness();
    await waitFor(() => expect(h.latest().loaded).toBe(true));
    expect(h.latest().prefs.autoAdvance).toBe("off");
    expect(fetchMock).toHaveBeenCalledWith(
      "/resources/inspection-prefs",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});

describe("useInspectionPrefs — offline: a refused load is not a page error", () => {
  it("falls back to DEFAULTS and reports loaded when the connection is refused", async () => {
    const h = harness();
    await waitFor(() => expect(h.latest().loaded).toBe(true));
    expect(h.latest().prefs).toMatchObject({ autoAdvance: "always", autoAdvanceDelayMs: 200 });
  });

  it("treats a non-OK answer the same way", async () => {
    loadResponse = () => Promise.resolve(new Response("", { status: 503 }));
    const h = harness();
    await waitFor(() => expect(h.latest().loaded).toBe(true));
    expect(h.latest().prefs.autoAdvance).toBe("always");
  });
});

describe("useInspectionPrefs — IA-129: a failed save must not stand", () => {
  it("applies the change optimistically and submits it", () => {
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });
    expect(h.latest().prefs.autoAdvance).toBe("off");
    expect(h.latest().saveFailed).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("rolls the value back and reports the failure", () => {
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });
    expect(h.latest().prefs.autoAdvance).toBe("off");

    // The branch that did not exist.
    patchData = { ok: false, prefs: null };
    h.bump();

    expect(h.latest().prefs.autoAdvance).toBe("always");
    expect(h.latest().saveFailed).toBe(true);
  });

  it("keeps a successful save and stays quiet", () => {
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });

    patchData = { ok: true, prefs: { ...h.latest().prefs, autoAdvance: "off" as const } };
    h.bump();

    expect(h.latest().prefs.autoAdvance).toBe("off");
    expect(h.latest().saveFailed).toBe(false);
  });

  it("rolls back to where a BURST started, not to its second-to-last step", () => {
    // Consecutive edits accumulate into one submission (a shared fetcher would
    // otherwise cancel the in-flight one), so the undo target has to be the
    // state before the first of them.
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });
    act(() => { h.latest().patch({ autoAdvanceDelayMs: 900 }); });

    patchData = { ok: false, prefs: null };
    h.bump();

    expect(h.latest().prefs.autoAdvance).toBe("always");
    expect(h.latest().prefs.autoAdvanceDelayMs).toBe(200);
  });

  it("clears a previous failure when a new change is attempted", () => {
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });
    patchData = { ok: false, prefs: null };
    h.bump();
    expect(h.latest().saveFailed).toBe(true);

    patchData = undefined;
    act(() => { h.latest().patch({ autoAdvance: "keyboard" }); });
    expect(h.latest().saveFailed).toBe(false);
  });
});
