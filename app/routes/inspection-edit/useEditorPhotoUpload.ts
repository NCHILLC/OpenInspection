import { useCallback, useEffect, useRef } from "react";
import type * as Y from "yjs";
import { findingKey } from "~/hooks/findings/shared";
import { pushToast } from "~/hooks/useToast";
import { appendPendingPhoto } from "~/lib/collab/results-binding";
import { enqueueMedia } from "~/lib/collab/media-upload-queue";
import { preprocessImage } from "~/components/media-studio/preprocessImage";
import { m } from "~/paraglide/messages";
import { originalQualityEnabled } from "./original-quality";
import type { useInspectionState } from "~/hooks/useInspection";
import type { useFindings } from "~/hooks/useFindings";

type InspectionState = ReturnType<typeof useInspectionState>;
type Findings = ReturnType<typeof useFindings>;

/** The subset of a React Router fetcher this hook drives. */
interface UploadFetcher {
    state: string;
    data: unknown;
    submit: (data: FormData, opts: { method: "post"; encType: "multipart/form-data" }) => void;
}

/** Which defect row a picked photo pins to, when one armed itself first. */
export type PendingPhotoTarget = { kind: "canned" | "custom"; id: string } | null;

export interface EditorPhotoUploadDeps {
    state: InspectionState;
    findings: Findings;
    uploadFetcher: UploadFetcher;
    /** `collab?.doc` — absent when the Durable Object binding is not configured. */
    collabDoc: Y.Doc | null | undefined;
    activeUnitId: string | null;
    cameraInputRef: React.RefObject<HTMLInputElement | null>;
    libraryInputRef: React.RefObject<HTMLInputElement | null>;
    /** Task 16 — a phone needs the explicit camera-vs-library chooser; a desktop
     *  file dialog already offers both, so it goes straight to the input. */
    isMobile: boolean;
    setAddMediaChooser: (value: { itemId: string } | null) => void;
}

export interface EditorPhotoUpload {
    handlePhotoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleBurstCommit: (blobs: Blob[]) => void;
    /**
     * Open the picker for THIS ITEM's photos.
     *
     * ⚠️ OPENING A PICKER AND SAYING WHERE THE PHOTO GOES ARE ONE ACT, WHICH IS
     * WHY THEY ARE ONE FUNCTION. They used to be two: a bare ref the defect chip
     * armed, cleared only when a photo actually arrived. Arm it and then CANCEL
     * the picker and it stayed armed — so the next photo added from the
     * item-level button silently attached to a finding the inspector had walked
     * away from. In the editor it just appears somewhere they did not put it; in
     * the report it is missing from the item and stuck on the finding.
     *
     * A test could catch a call site that forgot to clear. Not being able to
     * open a picker without stating the target is better than catching it.
     */
    openPickerForItem: () => void;
    /** Open the picker for one defect row's photos (FE-3). */
    openPickerForDefect: (target: NonNullable<PendingPhotoTarget>) => void;
    /** The inspector backed out of the chooser — drop any armed target. */
    clearPhotoTarget: () => void;
}

// Task 16 — Worker subrequest safety: a single submission fans out one
// upstream upload call per file (see action.server.ts's mapPool), so an
// unbounded selection could blow the per-request subrequest budget. Cap the
// batch and tell the user rather than silently dropping the overflow.
const MAX_BATCH_PHOTOS = 20;

/**
 * The editor's three photo entry points: the file pickers, the burst camera,
 * and the effect that attaches returned keys once the action responds.
 *
 * Lifted verbatim out of `inspection-edit.tsx` under the large-file ratchet
 * (`scripts/check-file-size.mjs`). The handler bodies, the `useCallback`
 * dependency lists and the effect's dependency list are unchanged from that
 * file — including `handleBurstCommit` depending on `state.inspection.id`,
 * which it does not read. Removing it would be a behaviour change (fewer
 * identity changes for a memoised child), so it stays.
 *
 * FE-2 — uploads go through the route action ("upload-photo" intent) on a
 * dedicated fetcher: the old direct fetch('/api/…/upload') bypassed the BFF
 * token relay (unauthenticated in saas, C-12 class) and swallowed every
 * failure silently. The effect below attaches returned keys and surfaces
 * failures as a toast.
 */
export function useEditorPhotoUpload({
    state,
    findings,
    uploadFetcher,
    collabDoc,
    activeUnitId,
    cameraInputRef,
    libraryInputRef,
    isMobile,
    setAddMediaChooser,
}: EditorPhotoUploadDeps): EditorPhotoUpload {
    const pendingPhotoTargetRef = useRef<PendingPhotoTarget>(null);

    const handlePhotoUpload = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const all = Array.from(e.target.files ?? []);
            if (all.length === 0 || !state.activeItemId) return;
            const itemId = state.activeItemId;
            const overflow = all.length > MAX_BATCH_PHOTOS;
            const files = overflow ? all.slice(0, MAX_BATCH_PHOTOS) : all;

            // N2+N4 — bake before submit (auto-orient + downscale + EXIF/GPS strip),
            // unless the user opted into original quality. Capture the
            // defect target ref into a local BEFORE the await so a second picker open
            // cannot clobber it. The offline branch below keeps the RAW File (Task 5
            // bakes at replay). Single-file selections take this exact same path with
            // a one-element array, so behavior is byte-identical to the old code.
            const orig = originalQualityEnabled();
            const target = pendingPhotoTargetRef.current;
            pendingPhotoTargetRef.current = null;
            void (async () => {
                const bakedFiles: File[] = [];
                for (const f of files) {
                    bakedFiles.push(orig ? f : await preprocessImage(f));
                }

                // #181 PR-G — offline: persist each baked photo locally + append a
                // PENDING doc entry (empty key + pendingUpload) per file. The strip
                // renders them from the local blob; the drain (on reconnect / online)
                // uploads each to R2 and swaps in the real key. Defect-targeted offline
                // adds fall back to the online fetcher (the pending-doc model covers
                // item photos; defect pending is out of scope) — they simply re-fire
                // when back online.
                const doc = collabDoc ?? null;
                const sid = state.sectionIdForItem(itemId) ?? state.currentSection?.id;
                if (typeof navigator !== "undefined" && navigator.onLine === false && doc && sid && !target) {
                    // Phase U (Batch C2a) — key the offline pending-photo doc entry to the active
                    // unit. At activeUnitId == null this === the legacy `_default:{sid}:{itemId}`.
                    const fk = findingKey(activeUnitId, sid, itemId);
                    for (const baked of bakedFiles) {
                        const pendingId = crypto.randomUUID();
                        await enqueueMedia({
                            pendingId,
                            inspectionId: String(state.inspection.id),
                            findingKey: fk,
                            kind: "photo",
                            blob: baked,
                            enqueuedAt: Date.now(),
                        });
                        appendPendingPhoto(doc, fk, pendingId);
                    }
                } else {
                    const formData = new FormData();
                    formData.append("intent", "upload-photo");
                    formData.append("itemId", itemId);
                    for (const baked of bakedFiles) formData.append("file", baked);
                    if (target) {
                        formData.append("targetType", "defect");
                        formData.append("customId", target.id);
                        formData.append("defectKind", target.kind);
                    }
                    uploadFetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
                }

                if (overflow) {
                    pushToast({
                        message: m.editor_route_photos_batch_capped(),
                        variant: "warning",
                        durationMs: 6000,
                    });
                }
            })();
            // Reset both inputs so re-picking the same file(s) re-fires onChange
            if (cameraInputRef.current) cameraInputRef.current.value = "";
            if (libraryInputRef.current) libraryInputRef.current.value = "";
        },
        [state.activeItemId, state.inspection.id, uploadFetcher, collabDoc, state.sectionIdForItem, state.currentSection, activeUnitId],
    );

    const handleBurstCommit = useCallback(
        (blobs: Blob[]) => {
            if (!state.burstCameraItemId || blobs.length === 0) return;
            const itemId = state.burstCameraItemId;
            // Burst frames always land on the ITEM, so a defect target armed by
            // a chip the inspector then walked away from must not survive to
            // catch the next single photo. Cleared here rather than at the call
            // site because this path never honours it anyway.
            pendingPhotoTargetRef.current = null;

            // N4 — bake each frame before upload. Burst frames are already
            // canvas-captured JPEGs (no EXIF), so this is purely the downscale; it
            // no-ops on frames already below the cap. Honors the original-quality opt-out.
            const orig = originalQualityEnabled();
            void (async () => {
                const formData = new FormData();
                formData.append("intent", "upload-photo");
                formData.append("itemId", itemId);
                for (let i = 0; i < blobs.length; i++) {
                    const f = new File([blobs[i]], `burst-${i + 1}.jpg`, { type: "image/jpeg" });
                    formData.append("file", orig ? f : await preprocessImage(f));
                }
                uploadFetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
            })();
        },
        [state.burstCameraItemId, state.inspection.id, uploadFetcher],
    );

    // Attach uploaded photo keys once the action responds — to the item, or
    // (FE-3) to the specific defect row the action echoes back.
    const processedUploadData = useRef<unknown>(null);
    useEffect(() => {
        const d = uploadFetcher.data as
            | {
                ok?: boolean;
                keys?: string[];
                // Task 15/16 — per-file status; drives the partial-failure toast below.
                results?: Array<{ index: number; ok: boolean; key?: string; error?: string }>;
                itemId?: string;
                targetType?: "item" | "defect";
                customId?: string;
                defectKind?: "canned" | "custom";
            }
            | undefined;
        if (uploadFetcher.state !== "idle" || !d || processedUploadData.current === d) return;
        processedUploadData.current = d;
        // Attach every successful key exactly as before — unchanged regardless of
        // whether the submission was a single file or a batch.
        if (d.keys?.length && d.itemId) {
            for (const k of d.keys) {
                if (d.targetType === "defect" && d.customId) {
                    findings.addPhotoToDefect(
                        d.itemId,
                        { kind: d.defectKind ?? "canned", id: d.customId },
                        k,
                    );
                } else {
                    findings.addPhotoToItem(d.itemId, k);
                }
            }
        }
        // Task 16 — results[] lets a batch report exactly how many of a large
        // selection made it, instead of an all-or-nothing toast. d.ok is derived
        // from results.every(ok) server-side, so without this a single failed file
        // in a 12-photo batch would fire BOTH the success toast (for the 11 that
        // attached) and the old generic failure toast — keep them mutually
        // exclusive here.
        if (d.results?.length) {
            const total = d.results.length;
            const successCount = d.results.filter((r) => r.ok).length;
            const failCount = total - successCount;
            if (failCount > 0) {
                pushToast({
                    message: m.editor_route_photos_partial_upload({ success: successCount, total, failed: failCount }),
                    variant: "error",
                    durationMs: 8000,
                });
            } else {
                pushToast({
                    message: m.editor_route_photos_added({ count: successCount, s: successCount === 1 ? "" : "s", toDefect: d.targetType === "defect" ? " to defect" : "" }),
                    variant: "success",
                    durationMs: 2000,
                });
            }
        } else if (d.ok === false) {
            // Fallback for a response shape without results[] (e.g. an older/other
            // action path) — preserves the pre-Task-16 generic failure toast.
            pushToast({
                message: m.editor_route_photo_upload_failed(),
                variant: "error",
                durationMs: 8000,
            });
        }
    }, [uploadFetcher.state, uploadFetcher.data, findings]);

    /** Arms the target, then opens whichever picker this device wants. */
    const openPicker = useCallback(
        (target: PendingPhotoTarget) => {
            if (uploadFetcher.state !== "idle") return;
            const itemId = state.activeItemId;
            pendingPhotoTargetRef.current = target;
            // Task 16 — desktop file pickers already offer camera-vs-library
            // natively, so go straight to the multi-select library input; mobile
            // needs the explicit chooser (camera capture has no multi-select).
            if (isMobile && itemId) setAddMediaChooser({ itemId });
            else libraryInputRef.current?.click();
        },
        [uploadFetcher.state, state.activeItemId, isMobile, setAddMediaChooser, libraryInputRef],
    );

    const openPickerForItem = useCallback(() => openPicker(null), [openPicker]);
    const openPickerForDefect = useCallback(
        (target: NonNullable<PendingPhotoTarget>) => openPicker(target),
        [openPicker],
    );
    const clearPhotoTarget = useCallback(() => {
        pendingPhotoTargetRef.current = null;
    }, []);

    return { handlePhotoUpload, handleBurstCommit, openPickerForItem, openPickerForDefect, clearPhotoTarget };
}
