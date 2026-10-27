import { useEffect, useRef, useState } from "react";
import { LimitationsPanel } from "../editor-shared/LimitationsPanel";
import { MobileBottomDrawer } from "~/components/MobileBottomDrawer";
import type { CustomLimitation } from "~/lib/limitations";
import { m } from "~/paraglide/messages";

export interface ItemReasonSheetProps {
  entries: ReadonlyArray<CustomLimitation>;
  required: boolean;
  label: string;
  phone: boolean;
  onAdd: (title: string) => void;
  onToggle: (id: string, included: boolean) => void;
}

export function ItemReasonSheet({
  entries,
  required,
  label,
  phone,
  onAdd,
  onToggle,
}: ItemReasonSheetProps) {
  const [open, setOpen] = useState(false);
  const prevRequiredRef = useRef(required);

  const recorded = entries.some((e) => e.included !== false);
  const needsReason = required && !recorded;

  useEffect(() => {
    if (!phone) {
      prevRequiredRef.current = required;
      return;
    }
    if (!prevRequiredRef.current && required && !recorded) {
      setOpen(true);
    }
    prevRequiredRef.current = required;
  }, [required, phone, recorded]);

  if (!required && entries.length === 0) {
    return null;
  }

  if (!phone || !needsReason) {
    return (
      <LimitationsPanel
        entries={entries}
        required={required}
        onAdd={onAdd}
        onToggle={onToggle}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="item-reason-bar"
        onClick={() => setOpen(true)}
        className="fixed inset-x-0 bottom-32 z-30 min-h-12 flex items-center gap-2 border-t border-ih-watch/40 bg-ih-watch-bg px-4 text-left text-[15px] font-bold text-ih-watch-fg"
      >
        <span className="flex-1">{m.editor_ni_reason_needed()}</span>
        {m.editor_ni_reason_add()}
      </button>
      {open && (
        <MobileBottomDrawer
          open
          onClose={() => setOpen(false)}
          title={m.editor_ni_reason_title({ label })}
          heightFraction={0.6}
        >
          <div className="p-4">
            <LimitationsPanel
              entries={[]}
              required
              onAdd={(t) => {
                onAdd(t);
                setOpen(false);
              }}
              onToggle={() => {}}
            />
          </div>
        </MobileBottomDrawer>
      )}
    </>
  );
}
