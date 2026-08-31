/**
 * The tag chips every inspection offers before the tenant defines any of its
 * own. A fixed list with no inputs, so it is a module constant rather than a
 * `useMemo` in the editor route — memoising a literal only hides that it never
 * changes.
 */
export interface PresetTag {
    id: string;
    name: string;
    color: string;
}

export const PRESET_TAGS: PresetTag[] = [
    { id: "follow-up", name: "Follow Up", color: "#ef4444" },
    { id: "urgent", name: "Urgent", color: "#f97316" },
    { id: "photo-needed", name: "Photo Needed", color: "#eab308" },
    { id: "re-inspect", name: "Re-inspect", color: "#3b82f6" },
    { id: "client-question", name: "Client Question", color: "#a855f7" },
];
