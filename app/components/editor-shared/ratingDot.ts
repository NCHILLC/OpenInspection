import { findRatingLevel, FALLBACK_RATING_LEVELS, type EditorRatingLevel } from "~/lib/rating-levels";

/**
 * Map a stored rating to the item-list dot colour.
 *
 * The colour comes from the template's rating level (its severity and
 * `isDefect`), never from the label or abbreviation: "Inspected" (IN) is
 * satisfactory-type because the template says `good`, not because of its name.
 * The label checks at the end only cover a rating that matches no level.
 */
export function ratingDotClass(rating: string, levels?: readonly EditorRatingLevel[]): string {
  const level = findRatingLevel(levels && levels.length > 0 ? levels : FALLBACK_RATING_LEVELS, rating);
  if (level) {
    if (level.isDefect === true || level.severity === "significant") return "bg-ih-bad";
    if (level.severity === "marginal") return "bg-ih-watch";
    if (level.severity === "good") return "bg-ih-ok";
    return "bg-ih-border-strong";
  }
  if (rating === "Satisfactory" || rating === "SAT") return "bg-ih-ok";
  if (rating === "Monitor" || rating === "MON") return "bg-ih-watch";
  if (rating === "Defect" || rating === "DEF") return "bg-ih-bad";
  return "bg-ih-border-strong";
}
