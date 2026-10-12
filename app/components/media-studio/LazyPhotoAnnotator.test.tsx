// @vitest-environment happy-dom
/**
 * The annotator's chunk has to be requested when the editor mounts, not when a
 * photo is first opened: the service worker caches a script only once it has
 * been asked for, and the first open may be offline. So the closed wrapper is
 * what triggers the load, and it draws nothing until the load lands.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LazyPhotoAnnotator } from "./LazyPhotoAnnotator";

vi.mock("./PhotoAnnotator", () => ({
  PhotoAnnotator: ({ open }: { open: boolean }) => <div data-testid="annotator">{open ? "open" : "closed"}</div>,
}));

const props = { photoUrl: null, onSave: () => {}, onClose: () => {} };

describe("LazyPhotoAnnotator", () => {
  it("loads the annotator while still closed, and passes props through", async () => {
    const { rerender } = render(<LazyPhotoAnnotator open={false} {...props} />);
    expect(screen.queryByTestId("annotator")).toBeNull();

    expect((await screen.findByTestId("annotator")).textContent).toBe("closed");

    rerender(<LazyPhotoAnnotator open {...props} />);
    expect(screen.getByTestId("annotator").textContent).toBe("open");
  });
});
