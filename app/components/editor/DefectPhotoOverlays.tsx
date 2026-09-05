import { MediaViewer } from "~/components/media-studio/MediaViewer";
import { PhotoAnnotator } from "~/components/media-studio/PhotoAnnotator";
import { PhotoCropper } from "~/components/media-studio/PhotoCropper";
import { fullResUrl } from "~/components/media-studio/cropImage";
import type { useDefectPhotoOps } from "~/hooks/useDefectPhotoOps";
import { m } from "~/paraglide/messages";

/**
 * The view + annotate + crop overlay trio for a defect's own photos —
 * rendered once, driven entirely by `useDefectPhotoOps`'s state. Mirrors the
 * item-photo MediaViewer/PhotoAnnotator/PhotoCropper block in
 * inspection-edit.tsx, split into its own component so that file (at its
 * line cap) only has to render one tag.
 */
export function DefectPhotoOverlays({
  ops,
  inspectionId,
  streamCustomerSubdomain,
  sectionName,
}: {
  ops: ReturnType<typeof useDefectPhotoOps>;
  inspectionId: string;
  streamCustomerSubdomain?: string | null;
  sectionName?: string;
}) {
  const { viewer, setViewer, galleryPhotos, onAction, cropTarget, setCropTarget, saveCrop, studio, setStudio, saveAnnotation } = ops;
  return (
    <>
      <MediaViewer
        photos={viewer.index !== null ? galleryPhotos(viewer.itemId, viewer.target) : []}
        index={viewer.index}
        onClose={() => setViewer((v) => ({ ...v, index: null }))}
        onAction={onAction}
        streamCustomerSubdomain={streamCustomerSubdomain}
        inspectionId={inspectionId}
      />
      <PhotoAnnotator
        open={!!studio}
        photoUrl={studio?.url ?? null}
        sectionName={sectionName}
        initialAnnotationsJson={null}
        onSave={saveAnnotation}
        onClose={() => setStudio(null)}
      />
      {cropTarget && (
        <PhotoCropper
          sourceUrl={fullResUrl(cropTarget.sourceUrl)}
          allowFree
          title={m.editor_route_crop_photo()}
          saveLabel={m.editor_route_save_crop()}
          onCancel={() => setCropTarget(null)}
          onSave={saveCrop}
        />
      )}
    </>
  );
}
