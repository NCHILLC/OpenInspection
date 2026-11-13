import { useMemo } from "react";
import { useBatchDelete } from "~/hooks/useBatchDelete";
import type { Inspection } from "~/lib/dashboard-schema";

/**
 * useBatchDelete wired to the inspection list's buckets: the buckets with the
 * rows asked to go already hidden, and each row's address for the failure report.
 * `keepSelected` receives the ids still there when a run ends.
 */
export function useListBatchDelete<B extends Record<string, unknown>>(loadedBuckets: B, keepSelected: (failedIds: Set<string>) => void) {
    const rows = useMemo(() => Object.values(loadedBuckets).flatMap((items) => items as Inspection[]), [loadedBuckets]);
    const presentIds = useMemo(() => new Set(rows.map((i) => i.id)), [rows]);
    const addressOf = useMemo(() => new Map(rows.map((i) => [i.id, i.address || i.propertyAddress || null] as const)), [rows]);
    const batch = useBatchDelete(presentIds, keepSelected);
    const { hiddenIds } = batch;
    // Rows asked to go are hidden at once; the server answer puts back any it refused.
    const buckets = useMemo(() => {
        if (hiddenIds.size === 0) return loadedBuckets;
        return Object.fromEntries(
            Object.entries(loadedBuckets).map(([key, items]) => [key, (items as Inspection[]).filter((i) => !hiddenIds.has(i.id))]),
        ) as B;
    }, [loadedBuckets, hiddenIds]);
    return { ...batch, buckets, addressOf };
}
