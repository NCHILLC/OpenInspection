import { useState } from "react";
import { Button } from "@core/shared-ui";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { BatchDeleteFailures } from "~/components/dashboard/BatchDeleteFailures";
import { m } from "~/paraglide/messages";

/**
 * The inspection list's selection bar, the confirm step before a permanent
 * delete, and the report of what the last delete could not remove. While a
 * delete runs (`busy`) the selection cannot be edited.
 */
export function BatchActionsBar({ count, busy, failures, addressOf, onDismissFailures, onDelete, onSelectAll, onClear }: {
    count: number;
    busy: boolean;
    failures: ReadonlyArray<{ id: string; error: string }>;
    addressOf: ReadonlyMap<string, string | null>;
    onDismissFailures: () => void;
    onDelete: () => void;
    onSelectAll: () => void;
    onClear: () => void;
}) {
    const [confirming, setConfirming] = useState(false);
    return (
        <>
            <BatchDeleteFailures failures={failures} addressOf={addressOf} onDismiss={onDismissFailures} />
            <ConfirmDialog
                open={confirming}
                title={m.inspections_list_delete_confirm_title()}
                message={count === 1 ? m.inspections_list_delete_confirm_message_one() : m.inspections_list_delete_confirm_message_other({ count })}
                confirmLabel={m.common_delete()}
                onConfirm={() => { setConfirming(false); onDelete(); }}
                onCancel={() => setConfirming(false)}
            />
            {count > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-ih-primary-tint rounded-lg border border-ih-border">
                    <span className="text-[13px] font-bold text-ih-primary-text">
                        {m.inspections_list_batch_selected({ count })}
                    </span>
                    <Button variant="danger" size="sm" disabled={busy} aria-busy={busy} onClick={() => setConfirming(true)}>{m.common_delete()}</Button>
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { if (!busy) onSelectAll(); }}>{m.inspections_list_batch_select_all()}</Button>
                    <Button variant="ghost" size="sm" onClick={() => { if (!busy) onClear(); }}>{m.common_clear()}</Button>
                </div>
            )}
        </>
    );
}
