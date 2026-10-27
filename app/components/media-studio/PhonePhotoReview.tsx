import { useState } from "react";
import { Icon } from "@core/shared-ui";
import { pushToast } from "~/hooks/useToast";
import { resolvePhotoDisplayKey } from "./photo-display-key";
import type { ItemPhotoStripProps, StripPhoto } from "./ItemPhotoStrip";
import { m } from "~/paraglide/messages";

/**
 * Canvas S09: on the phone, tapping a photo in the item's strip opens this full
 * screen instead of the lightbox. It reuses the strip's own handlers (the cover
 * flow, the delete-with-undo toast, the bulk move), so a photo changed here is
 * changed exactly as the viewer or the multi-select would change it.
 *
 * Not built: the canvas's Defect labels and its defect move targets. A defect's
 * photos live on the defect (their own array, their own handlers) and nothing
 * moves a photo between an item and a defect, so this screen covers the item's
 * own photos only.
 */
type ReviewAction = "cover" | "delete";

type Props = Pick<
  ItemPhotoStripProps,
  "photos" | "coverKey" | "photoUrl" | "moveTargets" | "onBulkMove" | "onOpen" | "videoPosterUrl" | "pendingPhotoUrl"
> & {
  itemLabel?: string;
  /** The photo that was tapped; it starts selected. */
  startIndex: number;
  onClose: () => void;
  onPhotoAction: (index: number, action: ReviewAction) => void;
};

const eyebrow = "text-[14px] font-bold uppercase tracking-[0.08em] text-ih-fg-3";
const actionBtn = "flex-1 h-15 flex flex-col items-center justify-center gap-0.5 rounded-md border text-[14px] font-bold";

export function PhonePhotoReview({ photos, coverKey, photoUrl, moveTargets, onBulkMove, onOpen, videoPosterUrl, pendingPhotoUrl, itemLabel, startIndex, onClose, onPhotoAction }: Props) {
  const [sel, setSel] = useState<number | null>(startIndex);
  const [moving, setMoving] = useState(false);

  const thumb = (p: StripPhoto, dk: string) =>
    p.mediaType === "video" && p.streamUid
      ? videoPosterUrl?.(p.streamUid, p.posterPct)
      : p.pendingId
        ? (pendingPhotoUrl?.(p.pendingId) ?? (dk ? photoUrl(dk) : undefined))
        : photoUrl(dk);

  const cover = () => { onClose(); onPhotoAction(sel!, "cover"); };
  const edit = () => { onClose(); onOpen(sel!); };
  const remove = () => { onPhotoAction(sel!, "delete"); setSel(null); };
  const move = (to: { itemId: string; sectionId?: string; label: string }) => {
    const undo = onBulkMove?.([sel!], { itemId: to.itemId, sectionId: to.sectionId });
    pushToast({
      message: m.editor_review_moved({ target: to.label }),
      variant: "neutral",
      durationMs: typeof undo === "function" ? 6000 : 5000,
      ...(typeof undo === "function" ? { actionLabel: m.common_undo(), onAction: undo } : {}),
    });
    setSel(null);
    setMoving(false);
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="photo-review-title" onKeyDown={(e) => e.key === "Escape" && (moving ? setMoving(false) : onClose())}
      className="fixed inset-0 z-[45] flex flex-col bg-ih-bg-app text-ih-fg-1">
      <header className="h-16 flex-none flex items-center gap-1 px-1 border-b border-ih-border">
        <button type="button" onClick={onClose} aria-label={m.editor_review_back()} className="w-12 h-12 flex items-center justify-center rounded-md text-ih-fg-2">
          <Icon name="back" size={24} />
        </button>
        <div className="flex-1 min-w-0 pl-1">
          {itemLabel && <div className={`${eyebrow} truncate`}>{itemLabel}</div>}
          <h2 id="photo-review-title" className="text-[22px] leading-tight font-bold">{m.editor_review_title({ count: photos.length })}</h2>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24">
        <ul className="list-none m-0 px-4 py-3 grid grid-cols-3 gap-2">
          {photos.map((p, i) => {
            const dk = resolvePhotoDisplayKey(p);
            const isCover = coverKey != null && coverKey === dk;
            const src = thumb(p, dk);
            return (
              <li key={dk || p.pendingId || `idx-${i}`}>
                <button type="button" aria-pressed={sel === i} aria-label={isCover ? m.editor_review_photo_cover_aria({ n: i + 1 }) : m.editor_review_photo_aria({ n: i + 1 })}
                  onClick={() => setSel(sel === i ? null : i)} className="w-full">
                  <span className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-ih-bg-muted ${sel === i ? "outline outline-[3px] outline-offset-2 outline-ih-primary" : ""}`}>
                    {src && <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />}
                    {isCover && (
                      <span className="absolute left-1.5 top-1.5 flex h-6 items-center gap-1 rounded-xl bg-ih-primary px-2 text-[13px] font-extrabold text-ih-primary-fg">
                        <svg className="h-3.25 w-3.25" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>
                        {m.media_strip_cover()}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mx-5 mt-1 text-[15px] text-ih-fg-3">{m.editor_review_note()}</p>
      </main>

      <nav aria-label={m.editor_review_title({ count: photos.length })} className="fixed inset-x-0 bottom-0 h-21 flex items-center gap-2 px-3 bg-ih-bg-card border-t border-ih-border">
        {sel === null ? (
          <>
            <span className="flex-1 text-[15px] text-ih-fg-3">{m.editor_review_tap_hint()}</span>
            <button type="button" onClick={onClose} className="h-13 px-5.5 rounded-md bg-ih-primary text-ih-primary-fg text-[18px] font-extrabold">{m.common_done()}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={cover} className={`${actionBtn} border-ih-border-strong text-ih-fg-2`}>
              <svg className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></svg>
              {m.media_annotate_cover_set()}
            </button>
            {onBulkMove && moveTargets && moveTargets.length > 0 && (
              <button type="button" onClick={() => setMoving(true)} className={`${actionBtn} border-ih-border-strong text-ih-fg-2`}>
                <Icon name="move" size={22} />{m.editor_review_move()}
              </button>
            )}
            <button type="button" onClick={edit} className={`${actionBtn} border-ih-border-strong text-ih-fg-2`}>
              <Icon name="edit" size={22} />{m.common_edit()}
            </button>
            <button type="button" onClick={remove} className={`${actionBtn} border-ih-bad text-ih-bad`}>
              <Icon name="trash" size={22} />{m.common_delete()}
            </button>
          </>
        )}
      </nav>

      {moving && (
        <>
          <button type="button" aria-label={m.common_cancel()} onClick={() => setMoving(false)} className="absolute inset-0 bg-ih-bg-app/60" />
          <section role="dialog" aria-label={m.editor_review_move_title()} className="absolute inset-x-0 bottom-0 flex max-h-[75%] flex-col gap-2.5 rounded-t-xl border-t border-ih-border-strong bg-ih-bg-card px-4 pb-4 pt-2">
            <div aria-hidden="true" className="mx-auto h-1 w-10 flex-none rounded-sm bg-ih-border-strong" />
            <h2 className="m-0 flex-none text-[22px] font-bold">{m.editor_review_move_title()}</h2>
            <ul className="m-0 min-h-0 list-none overflow-y-auto rounded-lg border border-ih-border p-0">
              {moveTargets?.map((t) => (
                <li key={t.itemId} className="border-b border-ih-border last:border-b-0">
                  <button type="button" onClick={() => move(t)} className="flex min-h-14 w-full items-center gap-2.5 px-3.5 text-left text-[17px] font-semibold">
                    <span className="flex-1">{t.label}</span>
                    <Icon name="chevR" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
