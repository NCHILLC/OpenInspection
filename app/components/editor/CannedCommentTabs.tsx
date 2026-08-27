import { useState, type MouseEvent } from "react";
import { TabStrip, Button, Icon } from "@core/shared-ui";
import { CannedCommentRow } from "../editor-shared/CannedCommentRow";
import { DefectFieldsRow, type DefectFieldsValue } from "./DefectFieldsRow";
import { RepairItemsPanel } from "./RepairItemsPanel";
import { CustomDefectForm } from "./CustomDefectForm";
import type { AttachedRepairItem } from "../../hooks/useFindings";
import { renderTemplate } from "../../lib/mustache";
import {
  DEFECT_TRADE_LABELS,
  DEFECT_DEADLINE_LABELS,
  DEFECT_TIMEFRAME_LABELS,
} from "../../lib/defect-fields";
import type { CustomDefect, CustomDefectCategory } from "../../lib/custom-defects";
import type { DefectTrade } from "../../lib/defect-fields";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/* Canned comment types */
/* ------------------------------------------------------------------ */

export interface CannedInfoComment {
  id: string;
  title: string;
  comment: string;
  default: boolean;
  /** Checklist-style answer options defined on the template comment. */
  choices?: string[];
}

export interface CannedDefect {
  id: string;
  title: string;
  category: string;
  location: string;
  comment: string;
  photos: string[];
  default: boolean;
  /** Checklist-style answer options defined on the template comment. */
  choices?: string[];
}

/** Track H — a tenant-library search hit (shape mirrors CommentEntry in
 *  useCannedComments; kept structural so this component stays hook-free). */
export interface LibraryMatch {
  id?: string;
  text: string;
  severity: string;
  category?: string | null;
  section?: string | null;
}

export type CannedTabId = "information" | "limitations" | "defects";

export interface CannedCommentTabsProps {
  visibleTabs: Array<{ id: CannedTabId; label: string; count?: number }>;
  activeTab: CannedTabId;
  onChangeTab: (id: CannedTabId) => void;

  /** All raw entries for the active tab (pre-search-filter). */
  rawTabEntries: Array<CannedInfoComment | CannedDefect>;
  /** Entries for the active tab after the Defects-tab search filter. */
  currentTabEntries: Array<CannedInfoComment | CannedDefect>;
  /** Included canned IDs for the active tab. */
  includedSet: Set<string>;

  defectQuery: string;
  onDefectQueryChange: (value: string) => void;

  /** result.attributes — Mustache vars for canned-comment prose. */
  resultAttributes: Record<string, unknown> | undefined;

  onToggleCanned?: (tabName: string, cannedId: string, included: boolean) => void;
  defectStates?: Map<string, DefectFieldsValue>;
  locationSuggestions?: string[];
  onDefectFields?: (cannedId: string, patch: Partial<DefectFieldsValue>) => void;
  /** Which of each comment's `choices` are currently checked, keyed by cannedId.
   *  Applies across all three tabs (a comment's choices aren't defects-only). */
  selectedChoicesByCannedId?: Map<string, string[]>;
  onChoicesChange?: (tab: CannedTabId, cannedId: string, selectedChoices: string[]) => void;
  /** This inspection's text override per comment, keyed by cannedId. Applies
   *  across all three tabs. */
  commentOverrideByCannedId?: Map<string, string>;
  onCommentChange?: (tab: CannedTabId, cannedId: string, comment: string) => void;
  /** "Needs follow-up" flag per comment, keyed by cannedId. Applies across all
   *  three tabs. No report meaning yet — visible and persisted only. */
  flaggedByCannedId?: Map<string, boolean>;
  onFlagChange?: (tab: CannedTabId, cannedId: string, flagged: boolean) => void;
  /** Seeds a new custom defect pre-filled from this canned defect. Defects-tab
   *  only — the custom-comment system it reuses doesn't exist for
   *  information/limitations. Absent → no duplicate icon. */
  onDuplicateCanned?: (entry: CannedDefect) => void;
  missingFields?: Map<string, { location: boolean; trade: boolean }>;
  requiredDefectFields?: { location: boolean; trade: boolean };

  /** Renders the per-defect "add photo" chip (closes over onAddDefectPhoto/photoUploading). */
  defectPhotoChip: (target: { kind: "canned" | "custom"; id: string }, count: number) => React.ReactNode;
  /** Photo count on a canned defect's STATE row. */
  cannedDefectPhotoCount: (cannedId: string) => number;

  /** Authoring unification Plan-4 module K — one tenant-wide lookup (keyed by
   *  BOTH defect_categories.name and .id) resolving a defect's `category` to
   *  its configured color. Forwarded to every CannedCommentRow's chip so the
   *  configured color renders in the editor, not just the report. */
  categoryColor?: Map<string, string>;

  /** Track H (IA-5 / migration step 3) — whole-library hits under the same search box. */
  libraryMatches: LibraryMatch[];
  /** Seeds the custom-defect form from a tapped library match. */
  onSeedFromLibrary: (match: LibraryMatch) => void;

  /** Field-authored custom defects already persisted on this item. */
  customDefects: Array<CustomDefect & { photos?: Array<{ key: string }> }>;
  onToggleCustomDefect?: (customId: string, included: boolean) => void;

  /** B-20 — add a field-authored custom defect. When unset the form is hidden. */
  onAddCustomDefect?: (input: { title: string; comment: string; category: CustomDefectCategory; trade?: DefectTrade | null }) => void;
  customFormOpen: boolean;
  /** Opens the custom-defect form (seeds title from query when no matches). */
  onOpenCustomForm: () => void;
  /** CustomDefectForm controlled props (state owned by ItemEditor). */
  customTitle: string;
  customComment: string;
  customCategory: CustomDefectCategory;
  /** IA-85 — the picked trade; `''` when the inspector picked none. */
  customTrade: DefectTrade | "";
  /** IA-59 — tenant defect categories offered in the custom-defect dropdown. */
  customCategories?: Array<{ id: string; name: string }>;
  saveToLibrary: boolean;
  showSaveToLibrary: boolean;
  onCustomTitleChange: (value: string) => void;
  onCustomCommentChange: (value: string) => void;
  onCustomCategoryChange: (value: CustomDefectCategory) => void;
  onCustomTradeChange: (value: DefectTrade | "") => void;
  onSaveToLibraryChange: (value: boolean) => void;
  onCancelCustomForm: () => void;
  onSubmitCustomDefect: () => void;

  /** Task 6 — attach repair items (snapshot estimate + contractor) to this finding. */
  attachedRepairItems?: AttachedRepairItem[];
  onAttachRepairItem?: (snap: AttachedRepairItem) => void;
  onDetachRepairItem?: (recommendationId: string) => void;
}

export function CannedCommentTabs({
  visibleTabs,
  activeTab,
  onChangeTab,
  rawTabEntries,
  currentTabEntries,
  includedSet,
  defectQuery,
  onDefectQueryChange,
  resultAttributes,
  onToggleCanned,
  defectStates,
  locationSuggestions,
  onDefectFields,
  selectedChoicesByCannedId,
  onChoicesChange,
  commentOverrideByCannedId,
  onCommentChange,
  flaggedByCannedId,
  onFlagChange,
  onDuplicateCanned,
  missingFields,
  requiredDefectFields,
  defectPhotoChip,
  cannedDefectPhotoCount,
  categoryColor,
  libraryMatches,
  onSeedFromLibrary,
  customDefects,
  onToggleCustomDefect,
  onAddCustomDefect,
  customFormOpen,
  onOpenCustomForm,
  customTitle,
  customComment,
  customCategory,
  customTrade,
  customCategories,
  saveToLibrary,
  showSaveToLibrary,
  onCustomTitleChange,
  onCustomCommentChange,
  onCustomCategoryChange,
  onCustomTradeChange,
  onSaveToLibraryChange,
  onCancelCustomForm,
  onSubmitCustomDefect,
  attachedRepairItems,
  onAttachRepairItem,
  onDetachRepairItem,
}: CannedCommentTabsProps) {
  // Which row's inline text-edit textarea is open — one at a time, tab-agnostic.
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);

  return (
    <div>
      {/* Tab strip (shared Design System component) */}
      <div className="mb-3">
        <TabStrip
          tabs={visibleTabs}
          activeId={activeTab}
          onChange={(id) => onChangeTab(id as CannedTabId)}
        />
      </div>

      {/* B-20 — searchable defect library */}
      {activeTab === "defects" && rawTabEntries.length > 0 && (
        <input
          value={defectQuery}
          onChange={(e) => onDefectQueryChange(e.target.value)}
          placeholder={m.editor_canned_search_placeholder()}
          aria-label={m.editor_canned_search_aria()}
          className="w-full h-9 px-3 mb-2 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus focus:border-ih-primary outline-none placeholder:text-ih-fg-4"
        />
      )}

      {/* Tab content: list of canned comments with toggles */}
      <div className="space-y-1.5">
        {currentTabEntries.length === 0 ? (
          <p className="text-[13px] text-ih-fg-3 text-center py-8">
            {activeTab === "defects" && defectQuery.trim()
              ? m.editor_canned_no_match({ query: defectQuery.trim() })
              : m.editor_canned_no_prebuilt()}
          </p>
        ) : (
          currentTabEntries.map((entry) => {
            const isIncluded = includedSet.has(entry.id);
            const isDefectIncluded = activeTab === "defects" && isIncluded;
            const st = isDefectIncluded ? (defectStates?.get(entry.id) ?? {}) : null;
            const attrEntries = resultAttributes && typeof resultAttributes === "object"
              ? Object.entries(resultAttributes as Record<string, unknown>) : [];
            const attrVars: Record<string, string | null> = {};
            for (const [k, v] of attrEntries) {
              if (v === null || v === undefined) attrVars[k] = null;
              else if (typeof v === "string") attrVars[k] = v.length > 0 ? v : null;
              else if (typeof v === "number" && Number.isFinite(v)) attrVars[k] = String(v);
              else if (typeof v === "boolean") attrVars[k] = v ? "yes" : "no";
              else attrVars[k] = null;
            }
            const vars = st ? {
              location:  st.location ?? null,
              trade:     st.trade     ? DEFECT_TRADE_LABELS[st.trade]         : null,
              deadline:  st.deadline  ? DEFECT_DEADLINE_LABELS[st.deadline]   : null,
              timeframe: st.timeframe ? DEFECT_TIMEFRAME_LABELS[st.timeframe] : null,
              ...attrVars,
            } : null;
            const effectiveComment = commentOverrideByCannedId?.get(entry.id) ?? entry.comment;
            const isFlagged = !!flaggedByCannedId?.get(entry.id);
            const isEditing = editingCommentId === entry.id;
            const stop = (fn: () => void) => (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn(); };
            return (
              <CannedCommentRow
                key={entry.id}
                as="label"
                selected={isIncluded}
                titleSlot={
                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                    <span>{entry.title}</span>
                    {isIncluded && (
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={stop(() => setEditingCommentId(isEditing ? null : entry.id))}
                          aria-label={m.editor_canned_edit_comment_aria()}
                          className="text-ih-fg-3 hover:text-ih-primary-text"
                        ><Icon name="edit" size={13} /></button>
                        {isDefectIncluded && defectPhotoChip({ kind: "canned", id: entry.id }, cannedDefectPhotoCount(entry.id))}
                        <button
                          type="button"
                          onClick={stop(() => onFlagChange?.(activeTab, entry.id, !isFlagged))}
                          aria-label={isFlagged ? m.editor_canned_unflag_aria() : m.editor_canned_flag_aria()}
                          className={isFlagged ? "text-ih-bad-fg" : "text-ih-fg-3 hover:text-ih-fg-2"}
                        ><Icon name="flag" size={13} /></button>
                      </span>
                    )}
                  </span>
                }
                category={"category" in entry ? (entry as CannedDefect).category || undefined : undefined}
                categoryColor={"category" in entry ? categoryColor?.get((entry as CannedDefect).category) : undefined}
                leading={
                  <input
                    type="checkbox"
                    checked={isIncluded}
                    onChange={() => onToggleCanned?.(activeTab, entry.id, !isIncluded)}
                    className="mt-0.5 w-4 h-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                  />
                }
                trailing={
                  isDefectIncluded && onDuplicateCanned ? (
                    <button
                      type="button"
                      onClick={stop(() => onDuplicateCanned(entry as CannedDefect))}
                      aria-label={m.editor_canned_duplicate_aria()}
                      className="text-ih-fg-3 hover:text-ih-primary-text mt-0.5"
                    ><Icon name="copy" size={14} /></button>
                  ) : undefined
                }
                bodySlot={
                  isEditing ? (
                    <textarea
                      defaultValue={effectiveComment}
                      onBlur={(e) => { onCommentChange?.(activeTab, entry.id, e.target.value); setEditingCommentId(null); }}
                      rows={2}
                      autoFocus
                      className="w-full mt-1 text-[11px] bg-transparent border border-ih-border rounded px-1 py-0.5 outline-none text-ih-fg-3"
                    />
                  ) : (
                    <p className={`text-[11px] mt-0.5 leading-relaxed ${isIncluded ? "text-ih-fg-3" : "text-ih-fg-4"}`}>
                      {vars ? renderTemplate(effectiveComment, vars) : effectiveComment}
                    </p>
                  )
                }
              >
                {isIncluded && entry.choices && entry.choices.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {entry.choices.map((choice) => {
                      const selected = selectedChoicesByCannedId?.get(entry.id) ?? [];
                      const checked = selected.includes(choice);
                      return (
                        <label key={choice} className="flex items-center gap-2 text-[12px] text-ih-fg-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = checked ? selected.filter((c) => c !== choice) : [...selected, choice];
                              onChoicesChange?.(activeTab, entry.id, next);
                            }}
                            className="w-3.5 h-3.5 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                          />
                          {choice}
                        </label>
                      );
                    })}
                  </div>
                )}
                {isDefectIncluded && (
                  <DefectFieldsRow
                    cannedId={entry.id}
                    value={st!}
                    locationSuggestions={locationSuggestions ?? []}
                    onChange={onDefectFields ?? (() => {})}
                    locationRequired={(requiredDefectFields?.location ?? false) || missingFields?.get(entry.id)?.location}
                    tradeRequired={(requiredDefectFields?.trade ?? false) || missingFields?.get(entry.id)?.trade}
                  />
                )}
              </CannedCommentRow>
            );
          })
        )}

        {/* Track H (IA-5 / migration step 3) — whole-library hits under the same search box.
            Tapping one SEEDS the custom-defect form (title from the first
            sentence, narrative = full text) so the inspector can edit before
            committing — a library comment is language, not a finished defect. */}
        {activeTab === "defects" && libraryMatches.length > 0 && (
          <div className="pt-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-ih-fg-3 px-1 pb-1">
              {m.editor_canned_from_library()}
            </div>
            <div className="space-y-1.5">
              {libraryMatches.map((match, i) => (
                <button
                  key={match.id ?? `lib-${i}`}
                  type="button"
                  onClick={() => onSeedFromLibrary(match)}
                  className="w-full text-left p-2.5 rounded-lg bg-ih-bg-app/50 hover:bg-ih-bg-muted border border-dashed border-ih-border transition-colors"
                >
                  <p className="text-[12px] leading-relaxed text-ih-fg-2 line-clamp-2">{match.text}</p>
                  <span className="text-[10px] text-ih-fg-3">
                    {match.severity !== "all" ? match.severity : m.editor_canned_any_severity()}
                    {match.section ? ` · ${match.section}` : ""} · {m.editor_canned_tap_to_use()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* B-20 — field-authored custom defects + inline add form */}
        {activeTab === "defects" && (
          <>
            {customDefects.map((cd) => (
              <CannedCommentRow
                key={cd.id}
                as="label"
                selected={cd.included !== false}
                title={cd.title}
                category={cd.category}
                categoryColor={categoryColor?.get(cd.category)}
                extraBadge={
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-ih-primary-tint text-ih-primary-text">
                    {m.editor_canned_custom_badge()}
                  </span>
                }
                leading={
                  <input
                    type="checkbox"
                    checked={cd.included !== false}
                    onChange={() => onToggleCustomDefect?.(cd.id, !(cd.included !== false))}
                    className="mt-0.5 w-4 h-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                  />
                }
                bodySlot={
                  // IA-85 — the comment AND the trade. A canned defect shows its
                  // trade in a labelled control on the row; a custom one showed
                  // nothing, so an inspector who had just picked one could not
                  // see what they picked, let alone notice a wrong one.
                  // Read-only here: there is no edit surface for a saved custom
                  // defect yet, and showing the value is the prerequisite for it.
                  (cd.comment || cd.trade) ? (
                    <>
                      {cd.comment && (
                        <p className="text-[12px] mt-0.5 leading-relaxed text-ih-fg-3">{cd.comment}</p>
                      )}
                      {/* fg-3, not fg-4: fg-4 measured 2.64:1 against the selected
                          row's tinted background at 11px, under the 4.5:1 AA floor
                          for small text, while the comment line above measures 4.9.
                          `lint:contrast` cannot see this — it reads the stylesheet,
                          not a background composited from a row tint at runtime. */}
                      {cd.trade && DEFECT_TRADE_LABELS[cd.trade] && (
                        <p className="text-[11px] mt-0.5 text-ih-fg-3">
                          {m.editor_customdefect_trade_summary({ trade: DEFECT_TRADE_LABELS[cd.trade] })}
                        </p>
                      )}
                    </>
                  ) : null
                }
              >
                {/* FE-3 — photo pinned to this custom defect */}
                {cd.included !== false &&
                  defectPhotoChip({ kind: "custom", id: cd.id }, Array.isArray(cd.photos) ? cd.photos.length : 0)}
              </CannedCommentRow>
            ))}

            {onAddCustomDefect && (
              customFormOpen ? (
                <CustomDefectForm
                  title={customTitle}
                  comment={customComment}
                  category={customCategory}
                  trade={customTrade}
                  categories={customCategories}
                  saveToLibrary={saveToLibrary}
                  showSaveToLibrary={showSaveToLibrary}
                  onTitleChange={onCustomTitleChange}
                  onCommentChange={onCustomCommentChange}
                  onCategoryChange={onCustomCategoryChange}
                  onTradeChange={onCustomTradeChange}
                  onSaveToLibraryChange={onSaveToLibraryChange}
                  onCancel={onCancelCustomForm}
                  onSubmit={onSubmitCustomDefect}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onOpenCustomForm}
                  className="w-full h-auto py-2.5 justify-start border border-dashed border-ih-border-strong text-ih-fg-3 hover:bg-transparent hover:border-ih-primary hover:text-ih-primary-text"
                >
                  {m.editor_canned_add_custom()}
                </Button>
              )
            )}
          </>
        )}

        {/* Task 6 — attach repair items (snapshot estimate + contractor) to this
            finding. Only on the Defects tab; only when the parent wires the callbacks. */}
        {activeTab === "defects" && onAttachRepairItem && onDetachRepairItem && (
          <RepairItemsPanel
            attached={attachedRepairItems ?? []}
            onAttach={onAttachRepairItem}
            onDetach={onDetachRepairItem}
          />
        )}
      </div>
    </div>
  );
}
