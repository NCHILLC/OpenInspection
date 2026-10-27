// @vitest-environment happy-dom
/**
 * Canvas X1: a photo that is only on this phone wears a yellow dot, in the
 * item's strip and in the photo review grid, and the legend explaining the dot
 * appears only when at least one photo wears it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ItemPhotoStrip } from "./ItemPhotoStrip";
import { PhonePhotoReview } from "./PhonePhotoReview";

vi.mock("~/hooks/useBreakpoint", () => ({ useIsMobile: () => true }));

afterEach(cleanup);

const synced = { key: "a" };
const queued = { key: "b", pendingId: "p1", pendingUpload: true };

function strip(photos: Array<{ key: string; pendingId?: string }>) {
  render(
    <ItemPhotoStrip
      inspectionId="i"
      itemId="it"
      photos={photos}
      coverKey="a"
      photoUrl={(k) => `/u/${k}`}
      onAddPhoto={vi.fn()}
      onOpen={vi.fn()}
      onPhotoAction={vi.fn()}
    />,
  );
}

describe("pending photo dot", () => {
  it("marks only the photo that has not uploaded, and explains the dot", () => {
    strip([synced, queued]);
    expect(screen.getAllByTestId("pending-dot")).toHaveLength(1);
    expect(screen.getByTestId("thumb-1").querySelector("[data-testid=pending-dot]")).not.toBeNull();
    expect(screen.getByTestId("thumb-0").querySelector("[data-testid=pending-dot]")).toBeNull();
    expect(screen.getByText("A yellow dot means the photo is saved on this phone and has not uploaded yet.")).toBeTruthy();
  });

  it("shows neither the dot nor the legend when every photo has uploaded", () => {
    strip([synced]);
    expect(screen.queryByTestId("pending-dot")).toBeNull();
    expect(screen.queryByTestId("pending-dot-legend")).toBeNull();
  });

  it("marks the same photo in the review grid and names it as not uploaded", () => {
    render(
      <PhonePhotoReview
        photos={[synced, queued]}
        coverKey="a"
        photoUrl={(k) => `/u/${k}`}
        startIndex={0}
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onPhotoAction={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("pending-dot")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Photo 2, not uploaded" }).querySelector("[data-testid=pending-dot]")).not.toBeNull();
    expect(screen.getByTestId("pending-dot-legend")).toBeTruthy();
  });
});
