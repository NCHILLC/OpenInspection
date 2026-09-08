// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { DictationButton } from "./DictationButton";

afterEach(() => {
  cleanup();
  delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

/** A fake engine whose result/end handlers the test fires by hand. */
function installFakeEngine() {
  const instances: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null;
    onend: (() => void) | null;
  }> = [];
  class FakeRecognition {
    continuous = false;
    interimResults = false;
    onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null = null;
    onerror: (() => void) | null = null;
    onend: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn(() => this.onend?.());
    constructor() {
      instances.push(this);
    }
  }
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  return instances;
}

function Harness({ onChange }: { onChange: (v: string) => void }) {
  const ref = createRef<HTMLTextAreaElement>();
  return (
    <div>
      <textarea ref={ref} data-testid="field" defaultValue="" />
      <DictationButton value="" onChange={onChange} targetRef={ref} />
    </div>
  );
}

describe("DictationButton — engine available", () => {
  it("starts listening on tap and inserts the final transcript", () => {
    const instances = installFakeEngine();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByTestId("dictation-button"));
    expect(instances).toHaveLength(1);
    expect(instances[0].start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("dictation-button").getAttribute("aria-pressed")).toBe("true");

    act(() => instances[0].onresult?.({ results: [[{ transcript: "crack in the foundation" }]] }));
    expect(onChange).toHaveBeenCalledWith("crack in the foundation");
  });

  it("tapping again stops the session", () => {
    const instances = installFakeEngine();
    render(<Harness onChange={vi.fn()} />);
    const btn = screen.getByTestId("dictation-button");

    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(instances[0].stop).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("DictationButton — no engine in this browser (iOS Safari)", () => {
  it("has no pressed state and just focuses the field instead of throwing", () => {
    render(<Harness onChange={vi.fn()} />);
    const btn = screen.getByTestId("dictation-button");
    expect(btn.getAttribute("aria-pressed")).toBeNull();

    fireEvent.click(btn);
    expect(document.activeElement).toBe(screen.getByTestId("field"));
  });
});
