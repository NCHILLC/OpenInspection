import { useEffect, useState, type ComponentProps } from "react";
import type { PhotoAnnotator } from "./PhotoAnnotator";

type Props = ComponentProps<typeof PhotoAnnotator>;

/**
 * The annotator behind a dynamic import. Konva and react-konva's reconciler are
 * needed only once a photo is opened for markup, and loaded statically they
 * were close to half of the editor's route chunk — bytes a phone parsed before
 * the first section could render.
 *
 * The chunk is requested on MOUNT, not on first open. The service worker caches
 * a script only once it has been requested, and the first open may be in a
 * crawlspace: waiting for it would make markup an online-only feature.
 */
export function LazyPhotoAnnotator(props: Props) {
  const [Impl, setImpl] = useState<typeof PhotoAnnotator | null>(null);
  const { open, onClose } = props;

  useEffect(() => {
    if (Impl) return;
    let live = true;
    import("./PhotoAnnotator").then(
      (mod) => live && setImpl(() => mod.PhotoAnnotator),
      // ponytail: offline before the chunk was ever cached. Closing resets the
      // caller's state so the next tap retries; add a toast if this is ever
      // seen in the field.
      () => live && open && onClose(),
    );
    return () => {
      live = false;
    };
  }, [Impl, open, onClose]);

  return Impl ? <Impl {...props} /> : null;
}
