import { useMemo } from "react";
import { useKeyboard, type KeyboardHandlers } from "~/hooks/useKeyboard";
import type { useInspectionState } from "~/hooks/useInspection";
import type { useFindings } from "~/hooks/useFindings";
import type { useCannedComments } from "~/hooks/useCannedComments";

type InspectionState = ReturnType<typeof useInspectionState>;
type Findings = ReturnType<typeof useFindings>;
type CannedComments = ReturnType<typeof useCannedComments>;

/** A library row the cursor can land on — server-fetched or locally filtered. */
interface LibraryRow {
    id?: string;
    text: string;
}

/**
 * Everything the editor's key bindings reach for.
 *
 * ⚠️ THE LIST IS LONG BECAUSE THE ROUTE IS ONE COMPONENT, not because the
 * bindings are doing too much. `InspectionEditPage` holds every piece of editor
 * state in a single scope, so a binding that clears a rating and one that opens
 * the tag picker close over the same object. Narrowing this surface means
 * splitting that state up, which changes behaviour — out of scope for the
 * extraction that created this file. Read it as the seam the monolith already
 * had, exposed rather than introduced.
 */
export interface EditorKeyboardDeps {
    state: InspectionState;
    findings: Findings;
    comments: CannedComments;
    handleRating: (rating: string, source?: "pointer" | "keyboard") => void;
    handleCloneLast: (scope: "rating" | "rating_notes" | "all") => void;
    /** `inspectionPrefs.cloneDefault` — the tenant's configured clone scope. */
    cloneDefault: "rating" | "rating_notes" | "all";
    toggleSpeedMode: () => void;
    speedRate: (levelIdx: number) => void;
    openSnippets: () => void;
    commentLibraryItems: LibraryRow[];
    serverComments: LibraryRow[];
    /** `uploadFetcher.state` — the photo binding no-ops while a save is in flight. */
    uploadFetcherState: string;
    isMobile: boolean;
    setAddMediaChooser: (value: { itemId: string } | null) => void;
    libraryInputRef: React.RefObject<HTMLInputElement | null>;
    setPublishError: (value: string | null) => void;
    setTagPickerOpen: (value: boolean) => void;
}

/**
 * Binds the editor's keyboard shortcuts.
 *
 * Lifted verbatim out of `inspection-edit.tsx` under the large-file ratchet
 * (`scripts/check-file-size.mjs`); the handler bodies and the `useMemo`
 * dependency list are unchanged from that file.
 *
 * ⚠️ THE DEPENDENCY LIST IS DELIBERATELY NOT THE FULL CLOSURE. Several values
 * read inside the handlers — the setters, `libraryInputRef`, `handleCloneLast`,
 * `cloneDefault` — are absent from it, exactly as they were before the move.
 * That is safe here rather than merely tolerated: `useKeyboard` assigns
 * `handlersRef.current = handlers` on every render, so a stale memo result is
 * still replaced before any key is read, and the memo is a re-render economy
 * rather than a correctness boundary. Completing the list would be a behaviour
 * change (new object identity on more renders), so it is left alone.
 */
export function useEditorKeyboard({
    state,
    findings,
    comments,
    handleRating,
    handleCloneLast,
    cloneDefault,
    toggleSpeedMode,
    speedRate,
    openSnippets,
    commentLibraryItems,
    serverComments,
    uploadFetcherState,
    isMobile,
    setAddMediaChooser,
    libraryInputRef,
    setPublishError,
    setTagPickerOpen,
}: EditorKeyboardDeps) {
    const keyboardHandlers = useMemo<KeyboardHandlers>(
        () => ({
            onRate: (level: number) => {
                if (state.activeItemId && state.currentSection && state.ratingLevels[level - 1]) {
                    handleRating(state.ratingLevels[level - 1].id, 'keyboard');
                }
            },
            onClearRating: () => {
                if (state.activeItemId && state.currentSection) {
                    findings.setRating(state.currentSection.id, state.activeItemId, null);
                }
            },
            onNARating: () => {
                if (!state.activeItemId || !state.currentSection) return;
                const naLevel = state.ratingLevels.find((l) => {
                    const ab = (l.abbreviation || "").toUpperCase();
                    const nm = (l.name || l.label || "").toLowerCase();
                    return ab === "NA" || ab === "N/A" || nm.includes("not applicable");
                });
                if (naLevel) {
                    handleRating(naLevel.id, 'keyboard');
                }
            },
            onNextItem: () => state.navigateItem(1),
            onPrevItem: () => state.navigateItem(-1),
            onToggleSpeed: toggleSpeedMode,
            speedMode: state.speedMode,
            onSpeedRate: speedRate,
            onSpeedNext: () => {
                if (state.speedCurrent < state.speedQueue.length - 1) {
                    state.setSpeedCurrent(state.speedCurrent + 1);
                } else {
                    state.setSpeedCurrent(0);
                }
            },
            onSpeedPrev: () => {
                if (state.speedCurrent > 0) {
                    state.setSpeedCurrent(state.speedCurrent - 1);
                }
            },
            onSpeedOpenEditor: () => {
                if (!state.speedMode) return;
                const qi = state.speedQueue[state.speedCurrent];
                if (qi == null) return;
                const item = state.speedItemsRef.current[qi];
                if (!item) return;
                state.setSpeedMode(false);
                state.setActiveItemId(item.id);
                state.setCurrentSectionIdx(item.sectionIdx);
            },
            onOpenLibrary: () => {
                if (!state.activeItemId) return;
                const r = state.getResult(state.activeItemId);
                state.setCommentLibraryFilter(
                    state.severityForRatingId(r?.rating as string),
                );
                state.setCommentLibrarySearch("");
                state.setCommentLibrarySelectedIdx(0);
                state.setShowCommentLibrary(true);
            },
            onOpenSnippets: openSnippets,
            showCommentLibrary: state.showCommentLibrary,
            onLibraryDown: () => {
                state.setCommentLibrarySelectedIdx(
                    Math.min(
                        state.commentLibrarySelectedIdx + 1,
                        Math.max(serverComments.length, commentLibraryItems.length) - 1,
                    ),
                );
            },
            onLibraryUp: () => {
                state.setCommentLibrarySelectedIdx(
                    Math.max(state.commentLibrarySelectedIdx - 1, 0),
                );
            },
            onLibrarySelect: () => {
                const sel = serverComments[state.commentLibrarySelectedIdx]
                    ?? commentLibraryItems[state.commentLibrarySelectedIdx];
                if (sel && state.activeItemId && state.currentSection) {
                    findings.insertComment(
                        state.currentSection.id,
                        state.activeItemId,
                        sel.text,
                    );
                    if ('id' in sel && sel.id) comments.touchSnippet(sel.id as string);
                    state.setShowCommentLibrary(false);
                }
            },
            onLibraryClose: () => state.setShowCommentLibrary(false),
            onPhoto: () => {
                if (!state.activeItemId || uploadFetcherState !== "idle") return;
                // Task 16 — desktop file pickers already offer camera-vs-library choice
                // natively, so go straight to the multi-select library input; mobile
                // still needs the explicit chooser (camera capture has no multi-select).
                if (isMobile) {
                    setAddMediaChooser({ itemId: state.activeItemId });
                } else {
                    libraryInputRef.current?.click();
                }
            },
            onSave: () => findings.saveNow(),
            onPublish: () => { setPublishError(null); state.setShowPublishModal(true); },
            onCloneLast: () => handleCloneLast(cloneDefault),
            onSaveAsSnippet: () => {
                if (!state.activeItemId) return;
                const r = state.getResult(state.activeItemId);
                const notes = ((r?.notes as string) || "").trim();
                if (!notes) return;
                const severity = state.severityForRatingId(r?.rating as string);
                const section = state.currentSection?.title || "";
                comments.saveSnippet(notes, severity, section, undefined, (state.activeItem?.label || state.activeItem?.name || undefined) as string | undefined);
            },
            onToggleCheatsheet: () =>
                state.setShowCheatsheet(!state.showCheatsheet),
            onGotoSection: (idx: number) => {
                if (idx >= 0 && idx < state.sections.length) {
                    state.selectSection(idx);
                }
            },
            onOpenSectionPicker: () => state.openSectionPicker(),
            onOpenTagPicker: () => {
                if (!state.activeItemId) return;
                setTagPickerOpen(true);
            },
            onToggleFullscreen: () => state.setItemFullscreen(!state.itemFullscreen),
            onExitFullscreen: () => { if (state.itemFullscreen) state.setItemFullscreen(false); }, // guard: bare Escape (not fullscreen) = no-op
        }),
        [
            state,
            findings,
            handleRating,
            toggleSpeedMode,
            speedRate,
            openSnippets,
            comments,
            commentLibraryItems,
            serverComments,
            uploadFetcherState,
            isMobile,
        ],
    );

    useKeyboard(keyboardHandlers, true);
}
