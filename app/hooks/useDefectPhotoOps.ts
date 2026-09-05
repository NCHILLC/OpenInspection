import { useState, useCallback } from "react";
import type * as Y from "yjs";
import { resolvePhotoDisplayKey } from "~/components/media-studio/photo-display-key";
import type { MediaAction } from "~/components/media-studio/MediaViewer";
import type { GalleryPhoto } from "~/lib/inspection-media";
import { findingKey } from "~/hooks/findings/shared";
import type { PhotoCrop } from "~/components/media-studio/PhotoCropper";
import type { useInspectionState } from "~/hooks/useInspection";
import type { useFindings } from "~/hooks/useFindings";
import {
  setDefectPhotoCrop,
  setDefectPhotoAnnotation,
  removeDefectPhoto,
  revertDefectPhoto,
} from "~/lib/collab/defect-photo-binding";
import type { PhotoEntry } from "../../server/lib/collab/results-doc.types";

export type DefectPhotoTarget = { kind: "canned" | "custom"; id: string };

/**
 * View + annotate + crop for photos pinned to a defect row — the counterpart
 * to usePhotoOps's item-photo viewer, for `tabs.defects[].photos` /
 * `customComments.defects[].photos` instead of the item's own `photos[]`.
 *
 * A separate hook (not folded into usePhotoOps, which is at its file-size
 * cap) because a defect photo's storage location genuinely differs from an
 * item photo's — every mutation here resolves into the targeted defect's own
 * sub-array via defect-photo-binding.ts. MediaViewer / PhotoCropper /
 * PhotoAnnotator are REUSED as-is; only the save/mutate plumbing is new.
 *
 * Crop/annotate always need the network (mirrors item photos under collab):
 * there is no offline-queue shape for a defect-targeted derivative, so both
 * saves are no-ops without a live `collabDoc`. The recrop-clobbers-annotation
 * confirm reuses the SAME `setRecropWarn` state/modal item photos already
 * use — it is generic (no item-vs-defect coupling).
 */
export function useDefectPhotoOps(ctx: {
  state: ReturnType<typeof useInspectionState>;
  findings: ReturnType<typeof useFindings>;
  collabDoc: Y.Doc | null;
  activeUnitId: string | null;
  setRecropWarn: (v: { run: () => void } | null) => void;
}) {
  const { state, findings, collabDoc, activeUnitId, setRecropWarn } = ctx;

  const [viewer, setViewer] = useState<{ itemId: string; target: DefectPhotoTarget; index: number | null }>({
    itemId: "", target: { kind: "canned", id: "" }, index: null,
  });
  const [cropTarget, setCropTarget] = useState<{
    itemId: string; target: DefectPhotoTarget; photoIndex: number; sourceUrl: string; sectionId?: string; hasAnnotation: boolean;
  } | null>(null);
  const [studio, setStudio] = useState<{
    itemId: string; target: DefectPhotoTarget; photoIndex: number; url: string; sectionId?: string;
  } | null>(null);

  const getDefectPhotos = useCallback(
    (itemId: string, target: DefectPhotoTarget): PhotoEntry[] => {
      const r = findings.getResult(itemId, state.sectionIdForItem(itemId) ?? undefined);
      if (target.kind === "canned") {
        const rows = ((r.tabs as { defects?: Array<{ cannedId: string; photos?: PhotoEntry[] }> } | undefined)?.defects) ?? [];
        return rows.find((d) => d.cannedId === target.id)?.photos ?? [];
      }
      const rows = ((r.customComments as { defects?: Array<{ id: string; photos?: PhotoEntry[] }> } | undefined)?.defects) ?? [];
      return rows.find((d) => d.id === target.id)?.photos ?? [];
    },
    [findings, state.sectionIdForItem],
  );

  /** Map the viewed defect's photos[] → GalleryPhoto[] for MediaViewer. */
  const galleryPhotos = useCallback(
    (itemId: string, target: DefectPhotoTarget): GalleryPhoto[] =>
      getDefectPhotos(itemId, target).map((p, i) => {
        const dk = resolvePhotoDisplayKey(p);
        return {
          key: dk,
          url: `/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(dk)}`,
          label: "",
          itemId,
          photoIndex: i,
          annotated: !!p.annotatedKey,
          originalKey: p.key,
          croppedKey: p.croppedKey,
        };
      }),
    [getDefectPhotos, state.inspection.id],
  );

  const onOpenDefectPhoto = useCallback((itemId: string, target: DefectPhotoTarget, index: number) => {
    setViewer({ itemId, target, index });
  }, []);

  /** Resolve the composite finding key the viewed item's defect lives under. */
  const resolveFindingKey = useCallback(
    (itemId: string, sectionId?: string): string | null => {
      const sid = sectionId ?? state.sectionIdForItem(itemId);
      return sid ? findingKey(activeUnitId, sid, itemId) : null;
    },
    [state.sectionIdForItem, activeUnitId],
  );

  /** Route the MediaViewer toolbar for a defect photo. Cover/caption/rotate
   *  are not wired for defect photos (same TODO status as item photos). */
  const onAction = useCallback(
    (action: MediaAction, photo: GalleryPhoto) => {
      const { itemId, target } = viewer;
      const idx = photo.photoIndex;
      if (idx == null) return;
      const sectionId = state.currentSection?.id;
      if (action === "annotate") {
        const baseKey = photo.croppedKey || photo.originalKey || photo.key;
        setStudio({
          itemId, target, photoIndex: idx, sectionId,
          url: `/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(baseKey)}`,
        });
        return;
      }
      if (action === "crop") {
        const originalKey = photo.originalKey || photo.key;
        setCropTarget({
          itemId, target, photoIndex: idx, sectionId, hasAnnotation: !!photo.annotated,
          sourceUrl: `/api/inspections/${state.inspection.id}/photo?key=${encodeURIComponent(originalKey)}`,
        });
        return;
      }
      const fk = resolveFindingKey(itemId, sectionId);
      if (!collabDoc || !fk) return;
      const key = photo.originalKey || photo.key;
      if (action === "revert") revertDefectPhoto(collabDoc, fk, target, key);
      if (action === "delete") removeDefectPhoto(collabDoc, fk, target, key);
    },
    [viewer, state.inspection.id, state.currentSection, collabDoc, resolveFindingKey],
  );

  /** Bake + persist a cropped defect photo derivative. */
  const performCropSave = useCallback(
    (blob: Blob, crop: PhotoCrop) => {
      const t = cropTarget;
      if (!t || !collabDoc) return;
      const { itemId, target, photoIndex, sectionId } = t;
      const fk = resolveFindingKey(itemId, sectionId);
      if (!fk) return;
      const current = getDefectPhotos(itemId, target)[photoIndex];
      const cropTransform = { aspect: crop.aspect, orientation: crop.orientation, ...crop.pixels };
      const fd = new FormData();
      fd.append("image", new File([blob], "cropped.jpg", { type: "image/jpeg" }));
      fd.append("crop", JSON.stringify(cropTransform));
      if (sectionId) fd.append("sectionId", sectionId);
      fd.append("targetType", "defect");
      fd.append("customId", target.id);
      fd.append("defectKind", target.kind);
      void (async () => {
        const res = await fetch(
          `/api/inspections/${state.inspection.id}/items/${itemId}/photos/${photoIndex}/crop`,
          { method: "POST", credentials: "include", body: fd },
        );
        const body = (await res.json().catch(() => null)) as { data?: { croppedKey?: string } } | null;
        const croppedKey = body?.data?.croppedKey;
        if (current && croppedKey) setDefectPhotoCrop(collabDoc, fk, target, current.key, croppedKey, cropTransform, current);
      })();
    },
    [cropTarget, collabDoc, state.inspection.id, resolveFindingKey, getDefectPhotos],
  );

  const saveCrop = useCallback(
    (blob: Blob, crop: PhotoCrop) => {
      const t = cropTarget;
      setCropTarget(null);
      if (!t) return;
      if (t.hasAnnotation) setRecropWarn({ run: () => performCropSave(blob, crop) });
      else performCropSave(blob, crop);
    },
    [cropTarget, setRecropWarn, performCropSave],
  );

  /** Bake + persist an annotated defect photo derivative. */
  const saveAnnotation = useCallback(
    ({ blob, nodesJson }: { blob: Blob; nodesJson: string }) => {
      const t = studio;
      setStudio(null);
      if (!t || !collabDoc) return;
      const { itemId, target, photoIndex, sectionId } = t;
      const fk = resolveFindingKey(itemId, sectionId);
      if (!fk) return;
      const originalKey = getDefectPhotos(itemId, target)[photoIndex]?.key;
      const fd = new FormData();
      fd.append("nodes", nodesJson);
      if (sectionId) fd.append("sectionId", sectionId);
      fd.append("targetType", "defect");
      fd.append("customId", target.id);
      fd.append("defectKind", target.kind);
      fd.append("image", new File([blob], "annotated.png", { type: "image/png" }));
      void (async () => {
        const res = await fetch(
          `/api/inspections/${state.inspection.id}/items/${itemId}/photos/${photoIndex}/annotation`,
          { method: "POST", credentials: "include", body: fd },
        );
        const body = (await res.json().catch(() => null)) as { data?: { annotatedKey?: string } } | null;
        const annotatedKey = body?.data?.annotatedKey;
        if (originalKey && annotatedKey) setDefectPhotoAnnotation(collabDoc, fk, target, originalKey, annotatedKey, nodesJson);
      })();
    },
    [studio, collabDoc, state.inspection.id, resolveFindingKey, getDefectPhotos],
  );

  return {
    viewer, setViewer, onOpenDefectPhoto, galleryPhotos, onAction,
    cropTarget, setCropTarget, saveCrop,
    studio, setStudio, saveAnnotation,
  };
}
