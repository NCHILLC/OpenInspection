import { useEffect, useState } from "react";
import { photoSyncMode, setPhotoSyncMode, type PhotoSyncMode } from "~/lib/collab/photo-sync-mode";
import { m } from "~/paraglide/messages";

/**
 * When queued photos upload. Device-local, like the original-quality
 * preference beside it: the drain reads it with no network, and the reason for
 * choosing is this phone's battery and signal. `open` re-reads the stored value
 * each time the sheet opens.
 */
export function PhotoSyncModeSelect({ open }: { open: boolean }) {
  const [mode, setMode] = useState<PhotoSyncMode>("auto");
  useEffect(() => setMode(photoSyncMode()), [open]);
  return (
    <label className="block text-[16px] text-ih-fg-3">
      {m.editor_settings_sync_mode()}
      <select
        value={mode}
        onChange={(e) => {
          const next = e.target.value as PhotoSyncMode;
          setMode(next);
          setPhotoSyncMode(next);
        }}
        className="mt-1 block w-full rounded border border-ih-border-strong bg-ih-bg-card px-2 py-1.5 text-[16px] text-ih-fg-1"
        data-testid="photo-sync-mode"
      >
        <option value="auto">{m.editor_settings_sync_mode_auto()}</option>
        <option value="prompt">{m.editor_settings_sync_mode_prompt()}</option>
        <option value="wifi">{m.editor_settings_sync_mode_wifi()}</option>
      </select>
      <span className="block text-[14px] text-ih-fg-3">{m.editor_settings_sync_mode_help()}</span>
    </label>
  );
}
