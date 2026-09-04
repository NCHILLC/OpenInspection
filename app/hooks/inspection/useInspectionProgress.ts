import { useCallback, useMemo } from "react";
import type { InspectionContext } from "./helpers";
import { isItemComplete } from "~/lib/item-completeness";
import { hasFlaggedComment } from "~/components/editor-shared/item-tab-projections";

/**
 * Progress slice: overall + per-section completion, defect counts, and live
 * report stats. Pure derivations over `sections` / `getResult` / `ratingLevels`
 * / `severityForRatingId` from the shared context — same memo deps as the
 * original monolithic hook.
 */
export function useInspectionProgress(ctx: InspectionContext) {
  const { sections, ratingLevels, getResult, severityForRatingId } = ctx;

  const progress = useMemo(() => {
    let total = 0;
    let rated = 0;
    for (const sec of sections) {
      for (const item of sec.items || []) {
        total++;
        if (isItemComplete(getResult(item.id, sec.id))) rated++;
      }
    }
    return {
      total,
      rated,
      pct: total > 0 ? Math.round((rated / total) * 100) : 0,
    };
  }, [sections, getResult]);

  const sectionProgress = useCallback(
    (sectionId: string) => {
      const sec = sections.find((s) => s.id === sectionId);
      if (!sec) return { rated: 0, total: 0, percent: 0, hasDefect: false, hasFlagged: false };
      const total = sec.items.length;
      if (total === 0)
        return { rated: 0, total: 0, percent: 0, hasDefect: false, hasFlagged: false };
      let rated = 0;
      let hasDefect = false;
      let hasFlagged = false;
      for (const item of sec.items) {
        const r = getResult(item.id, sec.id);
        // Same completeness rule as the overall ring — this counted only
        // `r.rating`, so a section of filled-in non-rich items showed 0% while
        // the ring counted every one of them. See isItemComplete.
        if (isItemComplete(r)) rated++;
        // `hasDefect` stays rating-only on purpose: a defect is a SEVERITY, and
        // only a rating carries one. A text item holding a value is complete
        // without being a defect.
        if (r.rating != null) {
          const level = ratingLevels.find((l) => l.id === r.rating);
          if (level?.isDefect) hasDefect = true;
        }
        // Independent of rating and of defect: a flag is the inspector's own
        // "come back to this", and it has to survive to a screen they will
        // actually pass on the way out.
        if (hasFlaggedComment(r)) hasFlagged = true;
      }
      return {
        rated,
        total,
        percent: Math.round((rated / total) * 100),
        hasDefect,
        hasFlagged,
      };
    },
    [sections, getResult, ratingLevels],
  );

  const sectionDefectCount = useCallback(
    (sectionId: string): number => {
      const sec = sections.find((s) => s.id === sectionId);
      if (!sec) return 0;
      let count = 0;
      for (const item of sec.items || []) {
        const rating = getResult(item.id, sectionId)?.rating as string | null;
        if (!rating) continue;
        const level = ratingLevels.find((l) => l.id === rating);
        if (level?.isDefect || rating === "Defect") count++;
      }
      return count;
    },
    [sections, ratingLevels, getResult],
  );

  /** Live report stats */
  const reportStats = useMemo(() => {
    let total = 0;
    let rated = 0;
    let satisfactory = 0;
    let monitor = 0;
    let defect = 0;
    for (const sec of sections) {
      const items = sec.items || [];
      total += items.length;
      for (const item of items) {
        const ratingId = getResult(item.id, sec.id)?.rating as string | null;
        if (!ratingId) continue;
        rated++;
        const severity = severityForRatingId(ratingId);
        if (severity === "good") satisfactory++;
        else if (severity === "marginal") monitor++;
        else if (severity === "significant") defect++;
      }
    }
    return { total, rated, satisfactory, monitor, defect };
  }, [sections, getResult, severityForRatingId]);

  /** Overall stats incl. ETA — shape used by progress visualizations */
  const overallStats = useCallback(() => {
    let total = 0;
    let rated = 0;
    let satisfactory = 0;
    let monitor = 0;
    let defect = 0;
    for (const sec of sections) {
      const items = sec.items || [];
      for (const item of items) {
        total++;
        const ratingId = getResult(item.id, sec.id)?.rating as string | null;
        if (!ratingId) continue;
        rated++;
        const severity = severityForRatingId(ratingId);
        if (severity === "good") satisfactory++;
        else if (severity === "marginal") monitor++;
        else if (severity === "significant") defect++;
      }
    }
    const etaMinutes = Math.ceil((total - rated) * 0.35);
    return { total, rated, satisfactory, monitor, defect, etaMinutes };
  }, [sections, getResult, severityForRatingId]);

  return {
    progress,
    sectionProgress,
    sectionDefectCount,
    reportStats,
    overallStats,
  };
}
