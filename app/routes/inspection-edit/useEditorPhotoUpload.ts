import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { findingKey } from "~/hooks/findings/shared";
import { pushToast } from "~/hooks/useToast";
import { appendPendingPhoto } from "~/lib/collab/results-binding";
import { appendPendingPhotoToDefect } from "~/lib/collab/defect-photo-binding";
import { enqueueMedia } from "~/lib/collab/media-upload-queue";
import { preprocessImage } from "~/components/media-studio/preprocessImage";
import { m } from "~/paraglide/messages";
import { originalQualityEnabled } from "./original-quality";
import type { useInspectionState } from "~/hooks/useInspection";
import type { useFindings } from "~/hooks/useFindings";
import type { GalleryPhoto } from "~/lib/inspection-media";
import type { useDefectPhotoOps } from "~/hooks/useDefectPhotoOps";
import type { ShotRef } from "~/components/editor/FieldCamera";

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
    /** #181 PR-G — kick the media queue. Every item photo now rides the queue,
     *  so this fires on the online path too, not just on reconnect. */
    drain: () => void;
    /** Field eval P1 (shoot-to-annotate) — reads back the item's own photos[]. */
    itemGalleryPhotos: (itemId: string) => GalleryPhoto[];
    /** Field eval P1 (shoot-to-annotate) — the PhotoAnnotator's one entry point. */
    openPhotoStudio: (next: { url: string | null; key: string | null; index: number; total: number }) => void;
    /** The defect-scoped counterpart — a session opened from a chip shoots into that defect's array. */
    defectPhotoOps: Pick<ReturnType<typeof useDefectPhotoOps>, "galleryPhotos" | "setStudio">;
}

export interface EditorPhotoUpload {
    handlePhotoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    /** One frame from the in-app camera, queued without closing the camera. */
    handleCameraFrame: (blob: Blob) => void;
    /** Opening an item picker also clears an abandoned defect target. */
    openPickerForItem: () => void;
    openPickerForChecklistItem: (itemId: string) => void;
    /** Open the picker for one defect row's photos (FE-3). */
    openPickerForDefect: (target: NonNullable<PendingPhotoTarget>, name?: string) => void;
    /** The inspector backed out of the chooser — drop any armed target. */
    clearPhotoTarget: () => void;
    /** The armed defect's name while its camera session lasts, for the camera's Defect segment. */
    armedDefectName: string | null;
    /** The camera's Item / Defect toggle: aim the next frames at the armed defect, or at the whole item. */
    setCameraTarget: (kind: "item" | "defect") => void;
    /**
     * Field eval P1 — mark a photo up without leaving the camera (toasts while it
     * is still uploading). With no argument: the last photo of whichever array
     * the session is shooting into. With a shot: that shot of the item's or the
     * armed defect's array, counted from the end.
     */
    handleAnnotateShot: (shot?: ShotRef) => void;
}

// Task 16 — Worker subrequest safety: a single submission fans out one
// upstream upload call per file (see action.server.ts's mapPool), so an
// unbounded selection could blow the per-request subrequest budget. Cap the
// batch and tell the user rather than silently dropping the overflow.
const MAX_BATCH_PHOTOS = 20;

/**
 * The editor's photo entry points: the file pickers, the in-app camera, and the
 * effect that attaches returned keys once the action responds. All of them go
 * through one `submitPhotos`, which is what makes a capture non-blocking.
 *
 * Lifted out of `inspection-edit.tsx` under the large-file ratchet
 * (`scripts/check-file-size.mjs`).
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
    drain,
    itemGalleryPhotos,
    openPhotoStudio,
    defectPhotoOps,
}: EditorPhotoUploadDeps): EditorPhotoUpload {
    const pendingPhotoTargetRef = useRef<PendingPhotoTarget>(null);
    const pickerItemIdRef = useRef<string | null>(null);
    // Kept apart from the pending target so the camera's toggle can aim at the
    // item and back without forgetting which defect the session came from.
    const armedDefectRef = useRef<PendingPhotoTarget>(null);
    const [armedDefectName, setArmedDefectName] = useState<string | null>(null);

    /* Defect-targeted uploads, serialised. See the note at the push site. */
    const fetcherQueueRef = useRef<FormData[]>([]);
    const fetcherBusyRef = useRef(false);
    const pumpFetcherQueue = useCallback(() => {
        if (fetcherBusyRef.current) return;
        const next = fetcherQueueRef.current.shift();
        if (!next) return;
        fetcherBusyRef.current = true;
        uploadFetcher.submit(next, { method: "post", encType: "multipart/form-data" });
    }, [uploadFetcher]);

    // The fetcher going idle is the only signal that the previous upload is done
    // (success or failure — a failed one must not wedge the queue either).
    useEffect(() => {
        if (uploadFetcher.state !== "idle") return;
        fetcherBusyRef.current = false;
        pumpFetcherQueue();
    }, [uploadFetcher.state, pumpFetcherQueue]);

    /**
     * The one funnel every photo goes through — file picker, library pick, and
     * every frame the in-app camera shoots.
     *
     * Item-scoped photos ALWAYS take the offline queue, online included. They did
     * not used to: the queue was reached only when `navigator.onLine === false`,
     * so the online path was a single in-flight fetcher, which is why the picker
     * had to early-return while it was busy and why the add tile disabled itself
     * between frames. A queued capture is never blocked by the one before it, so
     * neither control has to refuse a tap.
     *
     * DEFECT-scoped photos now take the same queue. They used to go straight to
     * the fetcher on the reasoning that the pending-doc model had no shape for
     * "photo 3 of canned defect X" — but it does: a defect row's `photos` array
     * holds the same PhotoEntry the item's does, pending markers included. What
     * was actually missing was the drain knowing WHICH array to swap into, which
     * is one optional field on the queue record. Offline, the old path posted to
     * a dead network, threw into the route error boundary ("Something went
     * wrong") and lost the photo — the P0 from the 2026-09-06 field eval.
     *
     * ONE case still takes the fetcher: the window before the collab doc is
     * live, where there is genuinely nothing to enqueue into.
     */
    const submitPhotos = useCallback(
        async (files: File[], itemId: string, target: PendingPhotoTarget): Promise<void> => {
            // N2+N4 — bake before submit (auto-orient + downscale + EXIF/GPS strip),
            // unless the user opted into original quality.
            const orig = originalQualityEnabled();
            const bakedFiles: File[] = [];
            for (const f of files) {
                bakedFiles.push(orig ? f : await preprocessImage(f));
            }

            // #181 PR-G — persist each baked photo locally + append a PENDING doc
            // entry (empty key + pendingUpload) per file. The strip renders them
            // from the local blob; the drain uploads each to R2 and swaps in the
            // real key.
            const doc = collabDoc ?? null;
            const sid = state.sectionIdForItem(itemId) ?? state.currentSection?.id;
            if (doc && sid) {
                // Phase U (Batch C2a) — key the offline pending-photo doc entry to the active
                // unit. At activeUnitId == null this === the legacy `_default:{sid}:{itemId}`.
                const fk = findingKey(activeUnitId, sid, itemId);
                for (const baked of bakedFiles) {
                    const pendingId = crypto.randomUUID();
                    await enqueueMedia({
                        pendingId,
                        inspectionId: String(state.inspection.id),
                        findingKey: fk,
                        // Absent for an item photo — the drain reads it to pick which
                        // photos array the real key gets swapped into.
                        ...(target ? { defectTarget: target } : {}),
                        kind: "photo",
                        blob: baked,
                        enqueuedAt: Date.now(),
                    });
                    if (target) {
                        appendPendingPhotoToDefect(doc, sid, itemId, target, pendingId, activeUnitId);
                    } else {
                        appendPendingPhoto(doc, fk, pendingId);
                    }
                }
                // Online this uploads immediately; offline the drain finds an empty
                // network and leaves the records queued for the `online` / collab-
                // resync triggers, exactly as before.
                drain();
                return;
            }

            const formData = new FormData();
            formData.append("intent", "upload-photo");
            formData.append("itemId", itemId);
            for (const baked of bakedFiles) formData.append("file", baked);
            if (target) {
                formData.append("targetType", "defect");
                formData.append("customId", target.id);
                formData.append("defectKind", target.kind);
            }
            // ONE AT A TIME. A fetcher aborts its in-flight request when the same
            // fetcher submits again, so a camera session shooting three photos of
            // one defect would land only the last. The queue below holds the rest
            // until the effect watching `uploadFetcher.state` says the last one
            // finished. Item photos never reach here — they ride the media queue.
            fetcherQueueRef.current.push(formData);
            pumpFetcherQueue();
        },
        [state.inspection.id, collabDoc, state.sectionIdForItem, state.currentSection, activeUnitId, drain, pumpFetcherQueue],
    );

    const handlePhotoUpload = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const all = Array.from(e.target.files ?? []);
            const itemId = pickerItemIdRef.current ?? state.activeItemId;
            if (all.length === 0 || !itemId) return;
            // The cap is a Worker subrequest guard on the FETCHER path, where one
            // submission fans out one upstream call per file. Kept for the library
            // picker, which is the only way to hand over 20+ files at once.
            const overflow = all.length > MAX_BATCH_PHOTOS;
            const files = overflow ? all.slice(0, MAX_BATCH_PHOTOS) : all;

            // Capture the defect target ref into a local BEFORE the await so a
            // second picker open cannot clobber it.
            const target = pendingPhotoTargetRef.current;
            pendingPhotoTargetRef.current = null;
            void (async () => {
                await submitPhotos(files, itemId, target);
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
        [state.activeItemId, submitPhotos, cameraInputRef, libraryInputRef],
    );

    /**
     * One frame from the in-app camera. Submitted the moment the shutter fires,
     * so the camera stays open and responsive while it uploads — the reason the
     * capture screen does not have to close between photos.
     *
     * The armed target is READ and not cleared, because a capture session is one
     * act: open the camera from a defect's chip and every frame in that session
     * belongs to that defect, not just the first. It is cleared when the camera
     * CLOSES, and by the item-level entry points (the strip's add tile, the
     * capture FAB) before they open it — so a chip armed and then abandoned
     * cannot catch a photo the inspector aimed at the item.
     */
    const handleCameraFrame = useCallback(
        (blob: Blob) => {
            const itemId = state.cameraItemId;
            if (!itemId) return;
            const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
            void submitPhotos([file], itemId, pendingPhotoTargetRef.current);
        },
        [state.cameraItemId, submitPhotos],
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
        (target: PendingPhotoTarget, name?: string, itemId = state.activeItemId) => {
            // The fetcher is now reached ONLY before the collab doc is live, so
            // that is the only state where a second submit could abort the one in
            // flight. With a doc, a defect add rides the queue like an item add
            // and must not be refused — refusing it (silently, which is how this
            // read on rural LTE: tap, nothing, tap again, nothing) was the bug.
            if (target && !collabDoc && uploadFetcher.state !== "idle") {
                pushToast({
                    message: m.editor_route_photo_upload_busy(),
                    variant: "warning",
                    durationMs: 3000,
                });
                return;
            }
            if (!itemId) return;
            pickerItemIdRef.current = itemId;
            pendingPhotoTargetRef.current = target;
            armedDefectRef.current = target;
            setArmedDefectName(target ? (name ?? null) : null);
            // Task 16 — desktop file pickers already offer camera-vs-library
            // natively, so go straight to the multi-select library input; mobile
            // needs the explicit chooser (camera capture has no multi-select).
            if (isMobile && itemId) setAddMediaChooser({ itemId });
            else libraryInputRef.current?.click();
        },
        [uploadFetcher.state, collabDoc, state.activeItemId, isMobile, setAddMediaChooser, libraryInputRef],
    );

    const openPickerForItem = useCallback(() => openPicker(null), [openPicker]);
    const openPickerForChecklistItem = useCallback((id: string) => openPicker(null, undefined, id), [openPicker]);
    const openPickerForDefect = useCallback(
        (target: NonNullable<PendingPhotoTarget>, name?: string) => openPicker(target, name),
        [openPicker],
    );
    const clearPhotoTarget = useCallback(() => {
        pickerItemIdRef.current = null;
        pendingPhotoTargetRef.current = null;
        armedDefectRef.current = null;
        setArmedDefectName(null);
    }, []);
    const setCameraTarget = useCallback((kind: "item" | "defect") => {
        pendingPhotoTargetRef.current = kind === "defect" ? armedDefectRef.current : null;
    }, []);

    // The camera's edit badge. It used to return silently for a defect session — a
    // visible button that did nothing — because only the item annotator was wired.
    const handleAnnotateShot = useCallback((shot?: ShotRef) => {
        const itemId = state.cameraItemId;
        if (!itemId) return;
        const target = shot ? (shot.defect ? armedDefectRef.current : null) : pendingPhotoTargetRef.current;
        const gallery = target ? defectPhotoOps.galleryPhotos(itemId, target) : itemGalleryPhotos(itemId);
        const photo = gallery.at(-1 - (shot?.fromEnd ?? 0));
        if (!photo) return;
        if (photo.pending) return pushToast({ message: m.editor_camera_annotate_still_uploading(), variant: "warning", durationMs: 2500 });
        const key = photo.croppedKey || photo.originalKey || photo.key;
        const url = `/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(key)}`;
        const index = photo.photoIndex ?? gallery.length - 1 - (shot?.fromEnd ?? 0);
        if (target) defectPhotoOps.setStudio({ itemId, target, photoIndex: index, url, sectionId: state.currentSection?.id, name: armedDefectName ?? undefined });
        else openPhotoStudio({ url, key, index, total: gallery.length });
    }, [state.cameraItemId, state.inspection.id, state.currentSection, itemGalleryPhotos, openPhotoStudio, defectPhotoOps, armedDefectName]);

    return {
        handlePhotoUpload,
        handleCameraFrame,
        openPickerForItem,
        openPickerForChecklistItem,
        openPickerForDefect,
        clearPhotoTarget,
        armedDefectName,
        setCameraTarget,
        handleAnnotateShot,
    };
}
