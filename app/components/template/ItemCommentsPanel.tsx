import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { TemplateItem, TemplateSection } from "./types";
import { CannedCommentRow } from "../editor-shared/CannedCommentRow";
import { RatingSegment, type RatingOption } from "../editor-shared/RatingSegment";
import { CommentTypeahead } from "../editor/CommentTypeahead";
import { useCommentTypeahead } from "../../hooks/useCommentTypeahead";
import { CopyMoveCommentsModal } from "./CopyMoveCommentsModal";
import {
  flattenItemTabs,
  fragmentBeforeCaret,
  replaceFragmentBeforeCaret,
} from "../../lib/comment-typeahead";

export interface ItemCommentsPanelProps {
  selectedItem: TemplateItem;
  activeSection: number;
  editingItem: string | null;
  /** Every section in the current template — powers the Copy/Move modal's
   *  Section/Item pickers. Copy/Move is scoped to THIS template only. */
  sections: TemplateSection[];
  updateSections: (fn: (s: TemplateSection[]) => TemplateSection[]) => void;
  addCannedToItem: (tab: "information" | "limitations" | "defects") => void;
  removeCannedFromItem: (tab: "information" | "limitations" | "defects", idx: number) => void;
  /** Module C: open the shared comment-library drawer hard-filtered to this
   *  item + the tab's rating bucket. Absent → the Browse-library entry is hidden. */
  onOpenLibrary?: (tab: "information" | "limitations" | "defects") => void;
  /** Authoring unification Plan-4 module K — tenant defect_categories color
   *  lookup (keyed by name AND id), so the defects-tab chip renders the
   *  tenant's configured color in template authoring too, not just the
   *  inspection editor + report. Absent → the chip's muted fallback. */
  categoryColor?: Map<string, string>;
  /** Tenant's defect categories (id/name/color), Findings tab only — powers
   *  the expanded row's severity/category icon-toggle. Absent/empty → the
   *  selector is hidden rather than rendered with zero options. */
  categories?: Array<{ id: string; name: string; color: string }>;
  /** Tenant's contractor types (id/name), Findings tab only — powers the
   *  expanded row's Recommendation dropdown. */
  contractorTypes?: Array<{ id: string; name: string }>;
}

type CannedTab = "information" | "limitations" | "defects";

/** Maps a defect category's *name* to a default icon: the three seed
 *  categories (maintenance/recommendation/safety) get purpose-built icons;
 *  any tenant-added custom category falls back to a generic tag icon. */
function iconForCategoryName(name: string): string {
  const n = name.trim().toLowerCase();
  if (n === "maintenance") return "wrench";
  if (n === "recommendation") return "minusCircle";
  if (n === "safety") return "alertTriangle";
  return "tag";
}

/** Fixed per-tab type indicator (not the tenant's configurable severity/category):
 *  a filled red checkmark marks a Findings/defect row, a green tag marks an
 *  Informational or Limitations row — shown in the collapsed row's title line. */
function TypeBadge({ tab }: { tab: CannedTab }) {
  if (tab === "defects") {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-ih-bad text-white shrink-0">
        <Icon name="checkMini" size={10} strokeWidth={3} />
      </span>
    );
  }
  return <Icon name="tag" size={13} className="text-ih-ok shrink-0" />;
}

export function ItemCommentsPanel({ selectedItem, activeSection, editingItem, sections, updateSections, addCannedToItem, removeCannedFromItem, onOpenLibrary, categoryColor, categories, contractorTypes }: ItemCommentsPanelProps) {
  // Inline comment typeahead (authoring assist) hosted ONCE at panel level and
  // keyed to the focused row. Source = this item's Tier-1 canned entries, same
  // as the inspection-side notes typeahead (mirrors ItemEditor's pattern).
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [taQuery, setTaQuery] = useState("");
  const [taOpen, setTaOpen] = useState(false);
  const activeElRef = useRef<HTMLTextAreaElement | null>(null);

  // Progressive-disclosure: which rows are expanded, keyed by `${tab}:${id}`
  // (id, not array index — index shifts on reorder, id doesn't).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const prevLengths = useRef<Record<CannedTab, number>>({ information: -1, limitations: -1, defects: -1 });

  // Bulk-action selection (copy/move/delete), independent of "Default to
  // checked?" and independent of expand state. Keyed the same way as `expanded`.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [copyMoveModal, setCopyMoveModal] = useState<{ tab: CannedTab; mode: "copy" | "move" } | null>(null);
  const currentSectionId = sections[activeSection]?.id ?? "";

  const taEntries = useMemo(() => flattenItemTabs(selectedItem.tabs), [selectedItem.tabs]);
  const ta = useCommentTypeahead(taEntries, taQuery, { max: 8 });

  // Auto-expand a newly-added row. addCannedToItem always pushes onto the end
  // of its tab's array, so a length increase means "the last entry is new."
  useEffect(() => {
    (["information", "limitations", "defects"] as const).forEach((tab) => {
      const arr = selectedItem.tabs?.[tab] ?? [];
      const prevLen = prevLengths.current[tab];
      if (prevLen >= 0 && arr.length > prevLen) {
        const last = arr[arr.length - 1];
        if (last) setExpanded((e) => ({ ...e, [`${tab}:${last.id}`]: true }));
      }
      prevLengths.current[tab] = arr.length;
    });
  }, [selectedItem.tabs]);

  const insertPick = (tab: CannedTab, ci: number, currentValue: string, replacement: string) => {
    const el = activeElRef.current;
    const caret = el?.selectionStart ?? currentValue.length;
    const next = replaceFragmentBeforeCaret(currentValue, caret, replacement);
    updateSections((s) => {
      const it = s[activeSection].items.find((i) => i.id === editingItem);
      if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].comment = next.value;
      return s;
    });
    setTaOpen(false);
    setTaQuery("");
    requestAnimationFrame(() => {
      if (el) { el.focus(); el.setSelectionRange(next.caret, next.caret); }
    });
  };

  function selectedIdsForTab(tab: CannedTab): Set<string> {
    return new Set(
      (selectedItem.tabs?.[tab] ?? [])
        .filter((c) => selected[`${tab}:${c.id}`])
        .map((c) => c.id)
    );
  }

  function clearSelection(tab: CannedTab, ids: Set<string>) {
    setSelected((sel) => {
      const next = { ...sel };
      ids.forEach((id) => delete next[`${tab}:${id}`]);
      return next;
    });
  }

  function bulkDeleteForTab(tab: CannedTab) {
    const ids = selectedIdsForTab(tab);
    if (ids.size === 0) return;
    updateSections((s) => {
      const it = s[activeSection].items.find((i) => i.id === editingItem);
      if (it?.tabs?.[tab]) it.tabs[tab] = it.tabs[tab].filter((c) => !ids.has(c.id));
      return s;
    });
    clearSelection(tab, ids);
  }

  function performCopyOrMove(targetSectionId: string, targetItemId: string) {
    if (!copyMoveModal) return;
    const { tab, mode } = copyMoveModal;
    const ids = selectedIdsForTab(tab);
    if (ids.size === 0) { setCopyMoveModal(null); return; }
    const prefix = tab === "defects" ? "rd_" : tab === "limitations" ? "rl_" : "ri_";
    updateSections((s) => {
      const sourceItem = s[activeSection].items.find((i) => i.id === editingItem);
      const targetSection = s.find((sec) => sec.id === targetSectionId);
      const targetItem = targetSection?.items.find((i) => i.id === targetItemId);
      if (!sourceItem?.tabs?.[tab] || !targetItem) return s;
      if (!targetItem.tabs) targetItem.tabs = { information: [], limitations: [], defects: [] };
      const toCopy = sourceItem.tabs[tab].filter((c) => ids.has(c.id));
      const clones = toCopy.map((c, i) => ({
        ...structuredClone(c),
        id: `${prefix}${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
      }));
      targetItem.tabs[tab].push(...clones);
      if (mode === "move") {
        sourceItem.tabs[tab] = sourceItem.tabs[tab].filter((c) => !ids.has(c.id));
      }
      return s;
    });
    clearSelection(tab, ids);
    setCopyMoveModal(null);
  }

  return (
    <>
      {(["information", "limitations", "defects"] as const).map((tab) => (
        <div key={tab}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 capitalize">{tab}</span>
            <div className="flex items-center gap-2">
              {onOpenLibrary && (
                <button
                  type="button"
                  data-testid={`browse-library-${tab}`}
                  onClick={() => onOpenLibrary(tab)}
                  className="text-[10px] font-bold text-ih-fg-3 hover:text-ih-primary-text"
                >
                  {m.templates_comments_browse_library()}
                </button>
              )}
              <button onClick={() => addCannedToItem(tab)} className="text-[10px] font-bold text-ih-primary-text hover:text-ih-primary-text">{m.templates_comments_add()}</button>
            </div>
          </div>
          {(() => {
            const rowsForTab = selectedItem.tabs?.[tab] || [];
            if (rowsForTab.length === 0) return null;
            const selectedCount = rowsForTab.filter((c) => selected[`${tab}:${c.id}`]).length;
            const allSelected = selectedCount === rowsForTab.length;
            return (
              <div className="flex items-center gap-2 mb-1.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelected((sel) => {
                      const next = { ...sel };
                      rowsForTab.forEach((c) => { next[`${tab}:${c.id}`] = checked; });
                      return next;
                    });
                  }}
                  className="accent-ih-primary"
                  aria-label={m.templates_comments_select_all_aria()}
                />
                <span className="text-[11px] text-ih-fg-3">{m.templates_comments_select_all_label()}</span>
                {selectedCount > 0 && (
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setCopyMoveModal({ tab, mode: "copy" })}
                      aria-label={m.templates_comments_copy_selected_aria()}
                      className="text-ih-fg-3 hover:text-ih-fg-2"
                    ><Icon name="copy" size={14} /></button>
                    <button
                      type="button"
                      onClick={() => setCopyMoveModal({ tab, mode: "move" })}
                      aria-label={m.templates_comments_move_selected_aria()}
                      className="text-ih-fg-3 hover:text-ih-fg-2"
                    ><Icon name="move" size={14} /></button>
                    <button
                      type="button"
                      onClick={() => bulkDeleteForTab(tab)}
                      aria-label={m.templates_comments_delete_selected_aria()}
                      className="text-ih-fg-3 hover:text-ih-bad-fg"
                    ><Icon name="trash" size={14} /></button>
                  </div>
                )}
              </div>
            );
          })()}
          {(selectedItem.tabs?.[tab] || []).map((c, ci, arr) => {
            const key = `${tab}:${ci}`;
            const rowKey = `${tab}:${c.id}`;
            const isExpanded = !!expanded[rowKey];
            const isDefects = tab === "defects";

            const resolvedCategoryId = isDefects
              ? categories?.find((cat) => cat.id === c.category)?.id
                ?? categories?.find((cat) => cat.name.toLowerCase() === (c.category ?? "").toLowerCase())?.id
                ?? categories?.[0]?.id
              : undefined;

            const severityRatings: RatingOption[] = (categories ?? []).map((cat) => ({
              value: cat.id,
              label: cat.name,
              tone: "neutral",
              icon: iconForCategoryName(cat.name),
              color: cat.id === resolvedCategoryId ? cat.color : undefined,
            }));

            // The chip renders whatever string it's given verbatim (no id
            // lookup of its own) — resolve to the tenant's category *name*
            // so switching severity via the RatingSegment (which writes back
            // the canonical id) doesn't turn the chip into a raw uuid.
            const categoryLabel = isDefects
              ? categories?.find((cat) => cat.id === resolvedCategoryId)?.name ?? c.category
              : undefined;

            return (
              <CannedCommentRow
                key={c.id}
                as="div"
                interactive={false}
                category={categoryLabel}
                categoryColor={isDefects ? categoryColor?.get(c.category ?? "") : undefined}
                leading={
                  <div className="flex items-start gap-1.5">
                    <input
                      type="checkbox"
                      checked={!!selected[rowKey]}
                      onChange={(e) => setSelected((sel) => ({ ...sel, [rowKey]: e.target.checked }))}
                      className="accent-ih-primary mt-1"
                      aria-label={m.templates_comments_select_aria()}
                    />
                    <div className="flex flex-col items-center gap-0.5 pt-0.5">
                      <button
                        type="button"
                        aria-label={isExpanded ? m.templates_comments_collapse_aria() : m.templates_comments_expand_aria()}
                        onClick={() => setExpanded((e) => ({ ...e, [rowKey]: !e[rowKey] }))}
                        className="text-ih-fg-3 hover:text-ih-fg-2"
                      ><Icon name={isExpanded ? "chevD" : "chevR"} size={14} /></button>
                      <button
                        aria-label={m.templates_comments_move_up()}
                        disabled={ci === 0}
                        onClick={() => updateSections((s) => {
                          const it = s[activeSection].items.find((i) => i.id === editingItem);
                          const a = it?.tabs?.[tab];
                          if (a && ci > 0) { const [m] = a.splice(ci, 1); a.splice(ci - 1, 0, m); }
                          return s;
                        })}
                        className="text-[10px] text-ih-fg-3 hover:text-ih-fg-2 disabled:opacity-30"
                      ><Icon name="chevU" size={14} /></button>
                      <button
                        aria-label={m.templates_comments_move_down()}
                        disabled={ci === arr.length - 1}
                        onClick={() => updateSections((s) => {
                          const it = s[activeSection].items.find((i) => i.id === editingItem);
                          const a = it?.tabs?.[tab];
                          if (a && ci < a.length - 1) { const [m] = a.splice(ci, 1); a.splice(ci + 1, 0, m); }
                          return s;
                        })}
                        className="text-[10px] text-ih-fg-3 hover:text-ih-fg-2 disabled:opacity-30"
                      ><Icon name="chevD" size={14} /></button>
                    </div>
                  </div>
                }
                titleSlot={
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <TypeBadge tab={tab} />
                    <input
                      value={c.title}
                      onChange={(e) => {
                        updateSections((s) => {
                          const it = s[activeSection].items.find((i) => i.id === editingItem);
                          if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].title = e.target.value;
                          return s;
                        });
                      }}
                      placeholder={m.templates_comments_title_placeholder()}
                      className="flex-1 min-w-0 text-[11px] font-bold bg-transparent border-b border-ih-border outline-none text-ih-fg-2"
                    />
                  </div>
                }
                trailing={
                  <button
                    onClick={() => removeCannedFromItem(tab, ci)}
                    className="text-ih-fg-3 hover:text-ih-bad-fg text-[10px] mt-1"
                    aria-label={m.templates_comments_delete_aria()}
                  >
                    &times;
                  </button>
                }
                bodySlot={isExpanded ? (
                  <div className="mt-1 space-y-2">
                    {isDefects && categories && categories.length > 0 && (
                      <RatingSegment
                        ariaLabel={m.templates_comments_severity_aria()}
                        size="sm"
                        value={resolvedCategoryId}
                        onChange={(v) => updateSections((s) => {
                          const it = s[activeSection].items.find((i) => i.id === editingItem);
                          if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].category = v;
                          return s;
                        })}
                        ratings={severityRatings}
                      />
                    )}
                    <label className="flex items-center gap-2" title={m.templates_comments_default_checked_hint()}>
                      <input
                        type="checkbox"
                        checked={!!c.default}
                        onChange={(e) => updateSections((s) => {
                          const it = s[activeSection].items.find((i) => i.id === editingItem);
                          if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].default = e.target.checked;
                          return s;
                        })}
                        className="accent-ih-primary"
                      />
                      <span className="text-[12px] text-ih-fg-3">{m.templates_comments_default_checked_label()}</span>
                    </label>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">
                        {m.templates_comments_choices_label()}
                      </label>
                      <textarea
                        value={(c.choices ?? []).join("\n")}
                        onChange={(e) => {
                          const value = e.target.value;
                          updateSections((s) => {
                            const it = s[activeSection].items.find((i) => i.id === editingItem);
                            if (it?.tabs?.[tab]?.[ci]) {
                              it.tabs[tab][ci].choices = value.split("\n").map((v) => v.trim()).filter(Boolean);
                            }
                            return s;
                          });
                        }}
                        placeholder={m.templates_comments_choices_placeholder()}
                        rows={4}
                        className="w-full px-2 py-1 rounded border border-ih-border text-[12px] bg-transparent outline-none font-mono"
                      />
                    </div>
                    {isDefects && (
                      <>
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">
                            {m.templates_comments_recommendation_label()}
                          </label>
                          <select
                            value={c.recommendedContractorTypeId ?? ""}
                            onChange={(e) => updateSections((s) => {
                              const it = s[activeSection].items.find((i) => i.id === editingItem);
                              const row = it?.tabs?.[tab]?.[ci];
                              if (row) {
                                if (e.target.value) row.recommendedContractorTypeId = e.target.value;
                                else delete row.recommendedContractorTypeId;
                              }
                              return s;
                            })}
                            className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none"
                          >
                            <option value="">{m.templates_comments_recommendation_none()}</option>
                            {(contractorTypes ?? []).map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">
                            {m.templates_comments_location_label()}
                          </label>
                          <input
                            value={c.location ?? ""}
                            onChange={(e) => updateSections((s) => {
                              const it = s[activeSection].items.find((i) => i.id === editingItem);
                              if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].location = e.target.value;
                              return s;
                            })}
                            placeholder={m.templates_comments_location_placeholder()}
                            className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none"
                          />
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              >
                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-ih-border">
                    <input
                      value={c.abbrev ?? ""}
                      onChange={(e) => {
                        updateSections((s) => {
                          const it = s[activeSection].items.find((i) => i.id === editingItem);
                          if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].abbrev = e.target.value.slice(0, 12);
                          return s;
                        });
                      }}
                      placeholder={m.templates_comments_abbr_placeholder()}
                      maxLength={12}
                      title={m.templates_comments_abbr_title()}
                      className="w-16 text-[10px] font-mono bg-transparent border-b border-ih-border outline-none text-ih-fg-3 mb-0.5"
                    />
                    <div className="relative">
                      <textarea
                        value={c.comment}
                        onFocus={(e) => { activeElRef.current = e.currentTarget; setActiveKey(key); }}
                        onChange={(e) => {
                          const val = e.target.value;
                          const caret = e.target.selectionStart ?? 0;
                          updateSections((s) => {
                            const it = s[activeSection].items.find((i) => i.id === editingItem);
                            if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].comment = val;
                            return s;
                          });
                          const frag = fragmentBeforeCaret(val, caret);
                          setActiveKey(key);
                          setTaQuery(frag);
                          setTaOpen(frag.trim().length >= 2);
                        }}
                        onBlur={() => setTaOpen(false)}
                        onKeyDown={(e) => {
                          if (activeKey === key && taOpen && ta.matches.length > 0) {
                            if (e.key === "ArrowDown") { e.preventDefault(); ta.move(1); return; }
                            if (e.key === "ArrowUp") { e.preventDefault(); ta.move(-1); return; }
                            if (e.key === "Enter" || e.key === "Tab") {
                              const pick = ta.current();
                              if (pick) { e.preventDefault(); insertPick(tab, ci, c.comment, pick.comment); return; }
                            }
                            if (e.key === "Escape") { e.preventDefault(); setTaOpen(false); return; }
                          }
                        }}
                        placeholder={m.templates_comments_text_placeholder()}
                        rows={2}
                        className="w-full text-[11px] bg-transparent border border-ih-border rounded px-1 py-0.5 outline-none text-ih-fg-3"
                      />
                      <CommentTypeahead
                        entries={taEntries}
                        matches={ta.matches}
                        query={taQuery}
                        open={taOpen && activeKey === key}
                        selectedIndex={ta.selectedIndex}
                        onHoverIndex={ta.setSelectedIndex}
                        onPick={(text) => insertPick(tab, ci, c.comment, text)}
                        onClose={() => setTaOpen(false)}
                      />
                    </div>
                  </div>
                )}
              </CannedCommentRow>
            );
          })}
        </div>
      ))}
      {copyMoveModal && (
        <CopyMoveCommentsModal
          mode={copyMoveModal.mode}
          sections={sections}
          defaultSectionId={currentSectionId}
          defaultItemId={editingItem ?? ""}
          onCancel={() => setCopyMoveModal(null)}
          onConfirm={performCopyOrMove}
        />
      )}
    </>
  );
}
