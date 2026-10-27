// @vitest-environment happy-dom
/**
 * Canvas S09 entry point: on the phone a tap on a strip thumbnail opens the
 * photo review (when the caller can act on photos); everywhere else it still
 * opens the viewer.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ItemPhotoStrip } from "./ItemPhotoStrip";
import { useIsMobile } from "~/hooks/useBreakpoint";

vi.mock("~/hooks/useBreakpoint", () => ({ useIsMobile: vi.fn() }));

afterEach(cleanup);
beforeEach(() => vi.mocked(useIsMobile).mockReset());

function strip(extra: Partial<Parameters<typeof ItemPhotoStrip>[0]> = {}) {
  const onOpen = vi.fn();
  const onPhotoAction = vi.fn();
  render(
    <ItemPhotoStrip
      inspectionId="i"
      itemId="it"
      photos={[{ key: "a" }, { key: "b" }]}
      coverKey="a"
      photoUrl={(k) => `/u/${k}`}
      onAddPhoto={vi.fn()}
      onOpen={onOpen}
      onPhotoAction={onPhotoAction}
      itemLabel="Downspouts"
      {...extra}
    />,
  );
  return { onOpen, onPhotoAction };
}

describe("ItemPhotoStrip tap target", () => {
  it("opens the photo review on the phone, with the tapped photo selected", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const { onOpen } = strip();
    fireEvent.click(screen.getByTestId("thumb-1"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Photos · 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Photo 2" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("still opens the viewer on larger screens", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    const { onOpen } = strip();
    fireEvent.click(screen.getByTestId("thumb-1"));
    expect(onOpen).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still opens the viewer on the phone when the caller gave no photo actions", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const { onOpen } = strip({ onPhotoAction: undefined });
    fireEvent.click(screen.getByTestId("thumb-0"));
    expect(onOpen).toHaveBeenCalledWith(0);
  });

  it("Done closes the review", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    strip();
    fireEvent.click(screen.getByTestId("thumb-0"));
    fireEvent.click(screen.getByRole("button", { name: "Photo 1, cover" })); // deselect
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
