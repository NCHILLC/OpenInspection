// @vitest-environment happy-dom
/**
 * Field eval P2 — damage stamps. The stamp row is progressive disclosure
 * (only under the Label tool, so the bar doesn't grow four more always-on
 * buttons) and each stamp is a plain trigger, not a persistent radio — the
 * armed one highlights via `activeStamp`, which PhotoAnnotator owns.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { AnnotationToolbar } from "./AnnotationToolbar";

afterEach(cleanup);

function renderToolbar(props: Partial<Parameters<typeof AnnotationToolbar>[0]> = {}) {
  const onSelectTool = vi.fn();
  const onSelectStamp = vi.fn();
  const onCaptionChange = vi.fn();
  render(
    <AnnotationToolbar
      tool="circle"
      caption=""
      onSelectTool={onSelectTool}
      onCaptionChange={onCaptionChange}
      activeStamp={null}
      onSelectStamp={onSelectStamp}
      {...props}
    />,
  );
  return { onSelectTool, onSelectStamp, onCaptionChange };
}

// The bar is dark in both themes, so a theme-flipping text token turned every
// unselected tool near-black on a phone in dark mode (2026-09-08 field eval).
describe("AnnotationToolbar — tool legibility", () => {
  it("paints unselected tools in literal white, never a theme-flipping token", () => {
    renderToolbar({ tool: "circle" });
    for (const id of ["arrow", "free", "text"]) {
      const cls = screen.getByTestId(`tool-${id}`).className;
      expect(cls).toMatch(/text-white/);
      expect(cls).not.toMatch(/fg-inverse/);
    }
  });
});

describe("AnnotationToolbar — damage stamps", () => {
  it("hides the stamp row under any tool other than Label", () => {
    renderToolbar({ tool: "circle" });
    expect(screen.queryByTestId("stamp-row")).toBeNull();
  });

  it("shows all four stamps once Label is the active tool", () => {
    renderToolbar({ tool: "text" });
    expect(screen.getByTestId("stamp-row")).toBeTruthy();
    for (const id of ["crack", "moisture", "missing", "damaged"]) {
      expect(screen.getByTestId(`stamp-${id}`)).toBeTruthy();
    }
  });

  it("reports the stamp's label text on tap, not its id", () => {
    const { onSelectStamp } = renderToolbar({ tool: "text" });
    fireEvent.click(screen.getByTestId("stamp-crack"));
    expect(onSelectStamp).toHaveBeenCalledWith("Crack");
  });

  it("highlights only the currently armed stamp", () => {
    renderToolbar({ tool: "text", activeStamp: "Moisture" });
    expect(screen.getByTestId("stamp-moisture").className).toMatch(/bg-ih-primary/);
    expect(screen.getByTestId("stamp-crack").className).not.toMatch(/bg-ih-primary/);
  });
});
