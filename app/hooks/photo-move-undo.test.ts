// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { restoreMovedPhotos, movePhotosWithUndo } from "./photo-move-undo";
import { movePhoto, reorderPhotos } from "~/lib/collab/results-binding";

vi.mock("~/lib/collab/results-binding", () => ({
    movePhoto: vi.fn(),
    reorderPhotos: vi.fn(),
}));

describe("restoreMovedPhotos", () => {
    beforeEach(() => {
        vi.mocked(movePhoto).mockClear();
        vi.mocked(reorderPhotos).mockClear();
    });

    it("moves keys back and reorders source when collab doc exists", () => {
        const doc = new Y.Doc();
        const patchItemPhotos = vi.fn();
        restoreMovedPhotos({
            collabDoc: doc,
            fromItemId: "i1",
            fromFindingKey: "fk1",
            toItemId: "i2",
            toFindingKey: "fk2",
            keysBefore: ["a", "b", "c"],
            moved: [
                { index: 1, entry: { key: "b" } },
            ],
            patchItemPhotos,
        });

        expect(movePhoto).toHaveBeenCalledWith(doc, "fk2", "fk1", "b");
        expect(reorderPhotos).toHaveBeenCalledWith(doc, "fk1", ["a", "b", "c"]);
        expect(patchItemPhotos).toHaveBeenCalledTimes(2);
    });

    it("does nothing to doc when collabDoc is null", () => {
        const patchItemPhotos = vi.fn();
        restoreMovedPhotos({
            collabDoc: null,
            fromItemId: "i1",
            fromFindingKey: "fk1",
            toItemId: "i2",
            toFindingKey: "fk2",
            keysBefore: ["a", "b"],
            moved: [
                { index: 0, entry: { key: "a" } },
            ],
            patchItemPhotos,
        });
        expect(movePhoto).not.toHaveBeenCalled();
        expect(reorderPhotos).not.toHaveBeenCalled();
    });

    it("local path re-inserts at original index and filters target", () => {
        const patchItemPhotos = vi.fn();
        restoreMovedPhotos({
            collabDoc: null,
            fromItemId: "i1",
            fromFindingKey: null,
            toItemId: "i2",
            toFindingKey: null,
            keysBefore: ["x", "y"],
            moved: [
                { index: 1, entry: { key: "m1", note: "n" } },
            ],
            patchItemPhotos,
        });
        // first call patches fromItemId - re-insert
        const fromUpdater = patchItemPhotos.mock.calls[0][1];
        const res1 = fromUpdater([{ key: "x" }]);
        expect(res1[0].key).toBe("x");
        expect(res1[1].key).toBe("m1");
        // second patches toItemId - filter
        const toUpdater = patchItemPhotos.mock.calls[1][1];
        const res2 = toUpdater([{ key: "m1" }, { key: "z" }]);
        expect(res2).toEqual([{ key: "z" }]);
    });
});

describe("movePhotosWithUndo", () => {
    beforeEach(() => {
        vi.mocked(movePhoto).mockClear();
        vi.mocked(reorderPhotos).mockClear();
    });

    it("does forward move and returns undo that restores", () => {
        const doc = new Y.Doc();
        const patchItemPhotos = vi.fn();
        const snapshot = [{ key: "a" }, { key: "b" }];
        const undo = movePhotosWithUndo({
            collabDoc: doc,
            fromItemId: "i1",
            fromFindingKey: "fk1",
            toItemId: "i2",
            toFindingKey: "fk2",
            snapshot,
            indices: [0, 1],
            patchItemPhotos,
        });
        expect(typeof undo).toBe("function");
        // forward move filters source
        const fromUpdater = patchItemPhotos.mock.calls[0][1];
        expect(fromUpdater([{ key: "a" }, { key: "b" }])).toEqual([]);
        // doc move called
        expect(movePhoto).toHaveBeenCalledWith(doc, "fk1", "fk2", "a");
        expect(movePhoto).toHaveBeenCalledWith(doc, "fk1", "fk2", "b");
        if (undo) {
            undo();
            expect(movePhoto).toHaveBeenCalledWith(doc, "fk2", "fk1", "a");
            expect(reorderPhotos).toHaveBeenCalledWith(doc, "fk1", ["a", "b"]);
        }
    });

    it("returns undefined when no indices resolve", () => {
        const patchItemPhotos = vi.fn();
        const undo = movePhotosWithUndo({
            collabDoc: null,
            fromItemId: "i1",
            fromFindingKey: null,
            toItemId: "i2",
            toFindingKey: null,
            snapshot: [{ key: "a" }],
            indices: [5],
            patchItemPhotos,
        });
        expect(undo).toBeUndefined();
        expect(patchItemPhotos).not.toHaveBeenCalled();
    });
});
