import { m } from "~/paraglide/messages";

/** Canvas X1: the yellow dot on a photo that is saved on this phone but has not uploaded yet. Phone only. */
export function PendingPhotoDot() {
  return (
    <span
      aria-hidden="true"
      data-testid="pending-dot"
      className="absolute right-1 top-1 h-3.5 w-3.5 rounded-full border-2 border-ih-bg-app bg-ih-watch md:hidden"
    />
  );
}

/** The line that explains the dot; rendered only where at least one photo wears it. */
export function PendingPhotoLegend() {
  return (
    <p data-testid="pending-dot-legend" className="mt-3 flex gap-2 text-[15px] text-ih-fg-3 md:hidden">
      <span aria-hidden="true" className="mt-1 h-3 w-3 flex-none rounded-full bg-ih-watch" />
      <span>{m.editor_photo_pending_dot_legend()}</span>
    </p>
  );
}
