import { useCallback } from "react";
import { pushToast } from "~/hooks/useToast";
import type { useFindings } from "~/hooks/useFindings";
import type { useInspectionState } from "~/hooks/useInspection";
import { m } from "~/paraglide/messages";

/**
 * Clone last for the button and the R key. The copy returns false when no
 * earlier item in the section has a rating, and the tap used to end there with
 * nothing on screen; say so instead.
 */
export function useCloneLast({ state, findings }: {
    state: ReturnType<typeof useInspectionState>;
    findings: ReturnType<typeof useFindings>;
}) {
    return useCallback((scope: "rating" | "rating_notes") => {
        if (!state.activeItemId || !state.currentSection) return;
        const copied = findings.cloneLast(
            state.currentSection.id,
            state.activeItemId,
            state.currentSectionItems as Array<{ id: string }>,
            scope,
        );
        if (!copied) pushToast({ message: m.editor_clone_last_none(), variant: "warning", durationMs: 4000 });
    }, [findings, state.activeItemId, state.currentSection, state.currentSectionItems]);
}
