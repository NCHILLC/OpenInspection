import { useEffect, useState } from "react";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import type { IsnSync } from "~/components/editor/PublishModal";

/**
 * The publish receipt's ISN line: what the last publish's ISN step did
 * (`isnSync`, set from the publish result) and "Send to ISN again", which posts
 * the `isn-report-link` intent (action-isn.server.ts). A retry's answer replaces
 * the publish's.
 */
export function useIsnSync() {
 const [isnSync, setIsnSync] = useState<IsnSync | null>(null);
 const { fetcher, submit, busy } = useGuardedSubmit<{ isnSync?: IsnSync | null }>();
 useEffect(() => { if (fetcher.data) setIsnSync(fetcher.data.isnSync ?? null); }, [fetcher.data]);
 return {
  setIsnSync,
  modalProps: { isnSync, isnRetrying: busy, onIsnRetry: () => { submit({ intent: "isn-report-link" }, { method: "post" }); } },
 };
}
