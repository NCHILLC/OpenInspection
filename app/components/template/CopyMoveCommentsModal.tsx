import { useState } from "react";
import { Button, IconButton } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { TemplateSection } from "./types";

export interface CopyMoveCommentsModalProps {
  mode: "copy" | "move";
  sections: TemplateSection[];
  defaultSectionId: string;
  defaultItemId: string;
  onCancel: () => void;
  onConfirm: (targetSectionId: string, targetItemId: string) => void;
}

/** Section → Item picker for bulk-copying/moving selected comments elsewhere
 *  in the SAME template (no cross-template picker — out of scope for now). */
export function CopyMoveCommentsModal({ mode, sections, defaultSectionId, defaultItemId, onCancel, onConfirm }: CopyMoveCommentsModalProps) {
  const [sectionId, setSectionId] = useState(defaultSectionId);
  const itemsInSection = sections.find((s) => s.id === sectionId)?.items.filter((it) => it.type === "rich") ?? [];
  const [itemId, setItemId] = useState(
    itemsInSection.some((it) => it.id === defaultItemId) ? defaultItemId : (itemsInSection[0]?.id ?? "")
  );

  function handleSectionChange(newSectionId: string) {
    setSectionId(newSectionId);
    const items = sections.find((s) => s.id === newSectionId)?.items.filter((it) => it.type === "rich") ?? [];
    setItemId(items[0]?.id ?? "");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ih-backdrop">
      <div className="bg-ih-bg-card text-ih-fg-1 rounded-lg shadow-ih-popover w-full max-w-md">
        <div className="px-5 py-3 border-b border-ih-border flex items-center justify-between">
          <h2 className="text-[14px] font-bold">
            {mode === "copy" ? m.templates_comments_copy_modal_title() : m.templates_comments_move_modal_title()}
          </h2>
          <IconButton onClick={onCancel} aria-label={m.common_close()} size="sm">&#x2715;</IconButton>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">
              {m.templates_comments_modal_section_label()}
            </label>
            <select
              value={sectionId}
              onChange={(e) => handleSectionChange(e.target.value)}
              className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none"
            >
              {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">
              {m.templates_comments_modal_item_label()}
            </label>
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none"
              disabled={itemsInSection.length === 0}
            >
              {itemsInSection.length === 0
                ? <option value="">{m.templates_comments_modal_item_none()}</option>
                : itemsInSection.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
            </select>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-ih-border flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>{m.common_cancel()}</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!itemId}
            onClick={() => onConfirm(sectionId, itemId)}
          >
            {mode === "copy" ? m.templates_comments_modal_confirm_copy() : m.templates_comments_modal_confirm_move()}
          </Button>
        </div>
      </div>
    </div>
  );
}
