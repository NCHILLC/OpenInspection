import React from "react";
import { cn } from "../../../packages/shared-ui/src/cn";
import { Icon } from "../../../packages/shared-ui/src/Icon";

export type RatingTone = "ok" | "warn" | "bad" | "info" | "neutral";

export interface RatingOption {
  value: string;
  label: string;
  tone: RatingTone;
  /** Short form for compact layouts (e.g. an abbreviation, or a bare index
   *  for BatchActionBar's numbered tiles). Falls back to `label` when
   *  omitted — used at `size="sm"`. */
  shortLabel?: string;
  /** Small hint rendered under the label (e.g. a keyboard-shortcut digit,
   *  mirroring RatingButtonRow's/SpeedMode's `idx + 1` hint). Also appended
   *  to the tile's `title` tooltip. */
  hint?: string;
  /** Dynamic, data-driven color override (e.g. a tenant-configured hex from
   *  the rating system). Wins over the tone token classes when present —
   *  mirrors BatchActionBar's existing `getRatingColor` inline-style
   *  pattern. Applies regardless of selection state: data-driven callers
   *  (batch mode) render every tile permanently in its assigned color, not
   *  just the currently-selected one. */
  color?: string;
  /** Icon name (from @core/shared-ui's Icon). When present, renders icon-only
   *  in place of the label/shortLabel text — e.g. a compact category/severity
   *  picker where the tile's accessible name (aria-label) carries the label. */
  icon?: string;
}

export interface RatingSegmentProps {
  ratings: RatingOption[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  /** `sm` (compact/icon tiles) · `md` (default row, RatingButtonRow-like) ·
   *  `lg` (large touch tiles, SpeedMode-like). Default `md`. */
  size?: "sm" | "md" | "lg";
  /** Accessible name for the radiogroup. */
  ariaLabel?: string;
  className?: string;
}

/* Single source of truth for severity-tone -> token mapping. `warn` uses the
 * `ih-watch` token family — there is no `ih-warn` token in tailwind.css (the
 * design system's "watch" naming predates this component); this is the
 * closest real token and matches RatingButtonRow's existing `marginal`
 * tier. */
const TONE_FILLED: Record<RatingTone, string> = {
  ok: "bg-ih-ok text-ih-fg-inverse",
  warn: "bg-ih-watch text-ih-fg-inverse",
  bad: "bg-ih-bad text-ih-fg-inverse",
  info: "bg-ih-info text-ih-fg-inverse",
  // Solid inverse chip (not `bg-ih-bg-muted`) — muted-bg + inverse-fg pairs
  // to ~1:1 contrast in both themes. This mirrors the pre-migration
  // RatingButtonRow `minor` tier's `bg-ih-bg-inverse`, which flips with
  // theme and correctly pairs with `ih-fg-inverse`.
  neutral: "bg-ih-bg-inverse text-ih-fg-inverse",
};

const TONE_IDLE: Record<RatingTone, string> = {
  // No resting tint: an unselected "good" tile (e.g. Inspected) must not read
  // as already answered (field eval FE — idle IN tile looked rated in Light
  // and Field). The other tones keep their idle tint — they're category
  // pickers (defect severity) with no "nothing happened yet" state to fake.
  ok: "bg-transparent text-ih-fg-3 border border-ih-border hover:bg-ih-ok-bg hover:text-ih-ok-fg",
  warn: "bg-ih-watch-bg text-ih-watch-fg border border-ih-watch/30 hover:bg-ih-watch/20",
  bad: "bg-ih-bad-bg text-ih-bad-fg border border-ih-bad/30 hover:bg-ih-bad/20",
  info: "bg-ih-info-bg text-ih-info-fg border border-ih-info/30 hover:bg-ih-info/20",
  neutral: "bg-transparent text-ih-fg-3 border border-ih-border hover:bg-ih-bg-muted",
};

const SIZE_CLASSES: Record<NonNullable<RatingSegmentProps["size"]>, string> = {
  // Font sizes are this fork's, not upstream's (11px/13px): a rating tile is
  // read at arm's length in a crawlspace, so the type is sized for that.
  // `@container` is upstream's F56 fix and is orthogonal to the size.
  sm: "h-8 min-w-8 px-2 rounded text-[14px] font-bold",
  md: "h-11 min-w-0 flex-1 px-3 rounded-lg text-[16px] font-bold @container",
  lg: "h-20 w-20 rounded-xl text-sm font-bold @container",
};

/**
 * F56 — where the abbreviation/full-label swap gets its width from.
 *
 * It used to be `sm:` — a VIEWPORT media query. Opening the editor's photo
 * drawer squeezed the rating row from ~456px to ~213px while the viewport
 * stayed at 1055px, so every tile kept rendering its full label inside a 44px
 * box: "Not Inspected" painted 93px wide in a 45px tile and ran 51px into the
 * next one. The viewport was never the box that ran out of room.
 *
 * The query container is each TILE, not the row, because what decides whether
 * a label fits is the tile's own width — and that depends on how many ratings
 * the system has (four for TREC, five for the default), which no row-level
 * threshold can know. `md` tiles are `flex-1 min-w-0` and `lg` tiles are
 * `w-20`, so neither takes its width from its content and `inline-size`
 * containment costs them nothing.
 *
 * ⚠️ `sm` tiles are deliberately NOT containers: their width comes from
 * `min-w-8 px-2` plus their content, and inline-size containment would tell the
 * box to ignore the content it is sized by. They always render the short form
 * anyway, so they have nothing to query for.
 *
 * 6.5rem = 104px is measured, not picked: the longest TREC label renders 93px
 * at 13px bold, and `px-3` adds 24px around it. Below that the tile shows the
 * abbreviation; a tile in the narrow window where the full label ALMOST fits
 * gets an ellipsis rather than an overlap, because the label span can finally
 * clip (see `block truncate`).
 *
 * ⚠️ This fork renders `md` tiles at 16px, not the 13px that measurement was
 * taken at, so 6.5rem is CONSERVATIVE here rather than exact: a label needing
 * ~115px gets the full form a little early and is cut with an ellipsis. Taken
 * unchanged on purpose — the ellipsis is the fallback upstream designed for,
 * and at phone widths every tile is far below the threshold and shows the
 * abbreviation either way.
 *
 * ⚠️ Both class names are written out in full below rather than built from a
 * shared `@min-[6.5rem]` constant. Tailwind finds utilities by scanning source
 * TEXT for candidates, so a class assembled at runtime from two fragments is a
 * class it never generates — the markup would carry it and no rule would
 * exist, which is the silent failure this whole finding is made of.
 */

/**
 * Domain rating-tile row. Consolidates the three hand-rolled rating-tile
 * copies (RatingButtonRow, BatchActionBar, SpeedMode) into one component;
 * lives in the app (not shared-ui) because the severity tone map is
 * domain-coupled (inspection rating severities), not a generic UI concern.
 *
 * Accessibility follows the same WAI-ARIA radiogroup pattern as
 * `SegmentedControl`: `role="radiogroup"` on the container, `role="radio"` +
 * `aria-checked` on each tile, a roving tabindex (only the selected tile is
 * tab-focusable), and Arrow/Home/End keys that move selection + focus.
 */
export function RatingSegment({
  ratings,
  value,
  onChange,
  size = "md",
  ariaLabel,
  className = "",
}: RatingSegmentProps) {
  const btnRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = ratings.findIndex((r) => r.value === value);
  // If value matches nothing, keep the first tile tab-focusable so the
  // group is always reachable by keyboard.
  const focusIndex = selectedIndex < 0 ? 0 : selectedIndex;

  function select(index: number) {
    const n = ratings.length;
    if (n === 0) return;
    const clamped = ((index % n) + n) % n;
    onChange(ratings[clamped].value);
    btnRefs.current[clamped]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        select(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        select(index - 1);
        break;
      case "Home":
        e.preventDefault();
        select(0);
        break;
      case "End":
        e.preventDefault();
        select(ratings.length - 1);
        break;
    }
  }

  const sizeClass = SIZE_CLASSES[size];

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("flex gap-2 flex-wrap", className)}
    >
      {ratings.map((r, i) => {
        const selected = r.value === value;
        const toneClass = selected ? TONE_FILLED[r.tone] : TONE_IDLE[r.tone];
        // A per-option `color` override wins over the tone token classes
        // (data-driven, like BatchActionBar's existing pattern) and applies
        // regardless of selection — see the RatingOption.color doc above.
        const style = r.color ? { background: r.color, color: "#fff" } : undefined;
        // At `size="sm"` (compact tiles, e.g. BatchActionBar) always show the
        // short form. At md/lg, swap on the TILE's own width: the abbreviation
        // while the tile is narrow, the full label once there is room for it —
        // see LABEL_FULL_AT for why this is a container query and not a
        // viewport breakpoint. When no `shortLabel` is provided, just render
        // the full label everywhere.
        //
        // An option carrying an `icon` renders that instead of any label: it is
        // the fork's glyph tile (no text to measure), so it never reaches the
        // width swap below.
        const text = r.icon ? (
          <Icon name={r.icon} size={16} />
        ) : size === "sm" ? (
          (r.shortLabel ?? r.label)
        ) : r.shortLabel ? (
          <>
            <span className="@min-[6.5rem]:hidden">{r.shortLabel}</span>
            <span className="hidden @min-[6.5rem]:inline">{r.label}</span>
          </>
        ) : (
          r.label
        );
        const title = r.hint ? `${r.label} (${r.hint})` : r.label;
        return (
          <button
            key={r.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={r.label}
            title={title}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(r.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`transition-colors focus:outline-none focus:shadow-ih-focus ${sizeClass} ${
              r.color ? "" : toneClass
            }`}
            style={style}
          >
            {/* `block`, and that is the whole point: `truncate` is
                overflow-hidden + ellipsis + nowrap, and overflow does nothing
                on a non-replaced INLINE box. This span carried `truncate`
                throughout the defect and clipped nothing — the label simply
                painted past the tile and over its neighbour. As a block it
                fills the tile's content box and can finally cut the text off. */}
            <span className="block truncate px-0.5">{text}</span>
            {r.hint != null && (
              // Hidden below sm: the hint is a KEYBOARD-shortcut digit, and a
              // phone has no keyboard — inside a fixed 44px tile it is pure
              // vertical noise crowding the label it sits under.
              <span className="hidden sm:block text-[12px] font-mono opacity-60 mt-0.5">{r.hint}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
