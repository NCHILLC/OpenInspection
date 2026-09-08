/**
 * Common defect locations, offered as one-tap chips above the free-text field
 * (field eval P1 — location was typed with no shortcut for the common case).
 *
 * Same reasoning as `lib/limitations`: a "Front" or "Attic" reads the same
 * over every template and property, so one global list covers the common
 * case and free text (already wired to a per-inspection datalist) covers the
 * rest — see `DefectFieldsRow`.
 *
 * ponytail: the eval's own wording asks for a "tenant-configurable" chip
 * row. Ships as a fixed global list instead — no settings UI, no DB column,
 * no CRUD for eight words that mean the same thing at every property. If a
 * tenant ever needs a trade-specific addition (e.g. "Rooftop unit"), promote
 * this to a `tenant_configs` column read the same way `defect_categories` is.
 */
export const STANDARD_LOCATION_IDS = [
    "front",
    "rear",
    "left",
    "right",
    "attic",
    "crawlspace",
    "garage",
    "other",
] as const;

export type StandardLocationId = (typeof STANDARD_LOCATION_IDS)[number];
