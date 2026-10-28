// @vitest-environment happy-dom
/**
 * Canvas S09: the phone's photo review. The screen owns no photo logic; it
 * routes to the strip's own handlers, so these tests pin the wiring: which
 * handler each button calls, with which index, and what the reader sees.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PhonePhotoReview } from "./PhonePhotoReview";
import { pushToast } from "~/hooks/useToast";

vi.mock("~/hooks/useToast", () => ({ pushToast: vi.fn() }));

afterEach(cleanup);
beforeEach(() => vi.mocked(pushToast).mockClear());

const photos = [{ key: "a" }, { key: "b", annotatedKey: "b2" }, { key: "c" }];
const moveTargets = [
  { itemId: "i2", sectionId: "s1", label: "Roof › Flashing" },
  { itemId: "i3", sectionId: "s2", label: "Plumbing › Water heater" },
];

function setup(props: Partial<Parameters<typeof PhonePhotoReview>[0]> = {}) {
  const fns = { onClose: vi.fn(), onPhotoAction: vi.fn(), onOpen: vi.fn(), onBulkMove: vi.fn() };
  render(
    <PhonePhotoReview
      photos={photos}
      coverKey="b2"
      photoUrl={(k) => `/u/${k}`}
      moveTargets={moveTargets}
      itemLabel="Gutters & Downspouts"
      startIndex={0}
      {...fns}
      {...props}
    />,
  );
  return fns;
}

describe("PhonePhotoReview", () => {
  it("titles the screen with the item and the photo count, and explains the cover", () => {
    setup();
    expect(screen.getByText("Gutters & Downspouts")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Photos · 3" })).toBeTruthy();
    expect(screen.getByText(/The cover photo shows first under this item in the report/)).toBeTruthy();
  });

  it("labels only the cover tile (matched on the displayed key) and starts with the tapped photo selected", () => {
    setup({ startIndex: 2 });
    expect(screen.getAllByText("Cover")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Photo 2, cover" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Photo 3" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Photo 1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("with nothing selected it offers Done instead of the photo actions", () => {
    const { onClose } = setup({ startIndex: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Photo 1" })); // tap the selected tile again
    expect(screen.getByText("Tap a photo to change it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Delete goes to the shared handler (which owns the undo toast) and clears the selection", () => {
    const { onPhotoAction } = setup({ startIndex: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onPhotoAction).toHaveBeenCalledWith(1, "delete");
    expect(screen.getByText("Tap a photo to change it.")).toBeTruthy();
  });

  it("Set as cover closes the review first, so the cover cropper is not hidden behind it", () => {
    const calls: string[] = [];
    setup({ startIndex: 2, onClose: () => calls.push("close"), onPhotoAction: (i, a) => calls.push(`${a}:${i}`) });
    fireEvent.click(screen.getByRole("button", { name: "Set as cover" }));
    expect(calls).toEqual(["close", "cover:2"]);
  });

  it("Edit hands the photo to the viewer", () => {
    const { onClose, onOpen } = setup({ startIndex: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("Move lists the other items, moves the selected photo by index, and says where it went", () => {
    const { onBulkMove } = setup({ startIndex: 0 });
    onBulkMove.mockReturnValue(vi.fn());
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByRole("dialog", { name: "Move photo to" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Roof › Flashing/ }));
    expect(onBulkMove).toHaveBeenCalledWith([0], { itemId: "i2", sectionId: "s1" });
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: "Moved to Roof › Flashing" }));
    expect(screen.queryByRole("dialog", { name: "Move photo to" })).toBeNull();
  });

  it("when onBulkMove returns a function, toast has Undo action that calls it", () => {
    const undo = vi.fn();
    const { onBulkMove } = setup({ startIndex: 1 });
    onBulkMove.mockReturnValue(undo);
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("button", { name: /Plumbing › Water heater/ }));
    expect(onBulkMove).toHaveBeenCalledWith([1], { itemId: "i3", sectionId: "s2" });
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Moved to Plumbing › Water heater",
        actionLabel: "Undo",
        onAction: undo,
        durationMs: 6000,
      }),
    );
    const toastCall = vi.mocked(pushToast).mock.calls[0][0];
    if (typeof toastCall.onAction === "function") {
      toastCall.onAction();
      expect(undo).toHaveBeenCalled();
    }
  });

  it("a stale destination leaves the photo selected and reports no success", () => {
    const { onBulkMove } = setup({ startIndex: 0 });
    onBulkMove.mockReturnValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("button", { name: /Roof › Flashing/ }));
    expect(pushToast).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Photo 1" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("hides Move when there is nowhere to move to", () => {
    setup({ moveTargets: [] });
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
  });
  it("passes canned and custom destinations on the same item without confusing their identities", () => {
    const onBulkMove = vi.fn(() => vi.fn());
    setup({ onBulkMove, moveTargets: [
      { kind: "defect", itemId: "i1", sectionId: "s1", unitId: "unit-a", defect: { kind: "canned", id: "d" }, label: "Canned leak" },
      { kind: "defect", itemId: "i1", sectionId: "s1", unitId: "unit-a", defect: { kind: "custom", id: "d" }, label: "Custom leak" },
    ] });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("button", { name: "Custom leak" }));
    expect(onBulkMove).toHaveBeenCalledWith([0], { kind: "defect", itemId: "i1", sectionId: "s1", unitId: "unit-a", defect: { kind: "custom", id: "d" } });
  });

});
