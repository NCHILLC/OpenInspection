// @vitest-environment happy-dom
/**
 * Notes reach the doc without a blur.
 *
 * -- WHAT WENT WRONG --------------------------------------------------------
 * `setNotes` echoed into `results` only and the doc write waited for the
 * textarea's blur. Reloading, a discarded tab or a crash before blur lost the
 * note while the header read "Synced" (QA sweep CORE-01). Dictation and the
 * comment typeahead inserted through the same local echo, so a note that was
 * dictated and never blurred was lost the same way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import * as Y from "yjs";
import { buildCollabFindingsApi } from "./collab-findings-api";
import { readResultMap } from "./results-binding";
import { DictationButton } from "~/components/editor/DictationButton";

const KEY = "_default:roof:covering";

/** A fresh API per call, the way `useFindings` rebuilds it on every render. */
function api(doc: Y.Doc) {
  return buildCollabFindingsApi(doc, {
    getResult: () => ({}),
    sectionIdForItem: () => "roof",
    setResults: () => {},
    setDirty: vi.fn(),
    setSaveStatus: () => {},
  });
}

const docNotes = (doc: Y.Doc) => readResultMap(doc)[KEY]?.notes;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe("notes idle commit", () => {
  it("writes the doc after 600 ms with no blur", () => {
    const doc = new Y.Doc();
    api(doc).setNotes("roof", "covering", "granule loss");

    expect(docNotes(doc)).toBeUndefined();
    vi.advanceTimersByTime(599);
    expect(docNotes(doc)).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(docNotes(doc)).toBe("granule loss");
  });

  it("keeps pushing the write back while typing continues, across API rebuilds", () => {
    const doc = new Y.Doc();
    api(doc).setNotes("roof", "covering", "gran");
    vi.advanceTimersByTime(400);
    api(doc).setNotes("roof", "covering", "granule loss");
    vi.advanceTimersByTime(400);
    expect(docNotes(doc)).toBeUndefined();

    vi.advanceTimersByTime(200);
    expect(docNotes(doc)).toBe("granule loss");
  });

  it("commitNotes (blur) writes at once and the older timer cannot put stale text back", () => {
    const doc = new Y.Doc();
    const f = api(doc);
    f.setNotes("roof", "covering", "granule");
    f.commitNotes("roof", "covering", "granule loss");
    expect(docNotes(doc)).toBe("granule loss");

    vi.advanceTimersByTime(1000);
    expect(docNotes(doc)).toBe("granule loss");
  });

  it("flushes on pagehide, before the idle timer", () => {
    const doc = new Y.Doc();
    api(doc).setNotes("roof", "covering", "typed then closed");

    window.dispatchEvent(new Event("pagehide"));
    expect(docNotes(doc)).toBe("typed then closed");
  });

  it("flushes when the page is hidden, and not when it becomes visible", () => {
    const doc = new Y.Doc();
    api(doc).setNotes("roof", "covering", "app switched away");
    const state = vi.spyOn(document, "visibilityState", "get");

    state.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(docNotes(doc)).toBeUndefined();

    state.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(docNotes(doc)).toBe("app switched away");
  });

  it("an appended snippet lands after the typed text, not before a stale timer", () => {
    const doc = new Y.Doc();
    const f = api(doc);
    f.setNotes("roof", "covering", "typed");
    f.insertComment("roof", "covering", "picked");
    expect(docNotes(doc)).toBe("typed\npicked");

    vi.advanceTimersByTime(1000);
    expect(docNotes(doc)).toBe("typed\npicked");
  });

  it("dictation rides the same timer as typing", () => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      static last: FakeRecognition | null = null;
      constructor() {
        FakeRecognition.last = this;
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;

    const doc = new Y.Doc();
    const f = api(doc);
    const ref = createRef<HTMLTextAreaElement>();
    render(
      <div>
        <textarea ref={ref} defaultValue="" />
        <DictationButton
          value=""
          onChange={(next) => f.setNotes("roof", "covering", next)}
          targetRef={ref}
        />
      </div>,
    );

    fireEvent.click(screen.getByTestId("dictation-button"));
    act(() => FakeRecognition.last?.onresult?.({ results: [[{ transcript: "cupped shingles" }]] }));
    expect(docNotes(doc)).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(docNotes(doc)).toBe("cupped shingles");
  });
});
