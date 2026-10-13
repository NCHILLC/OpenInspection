/**
 * The notes write path of the collab findings API.
 *
 * A note is typed, dictated, or picked from the comment typeahead into a
 * textarea CONTROLLED by `results`, and `results` is rebuilt from the doc on
 * every doc change. Writing each keystroke to the doc therefore round-trips
 * through that rebuild and jumps the caret, so a keystroke only echoes into
 * `results` (`setNotes`). The doc write is `commitNotes` on blur and, because a
 * reload, a discarded tab, or a navigation can arrive before any blur with the
 * header still saying "Synced", also an idle timer and a flush when the page is
 * hidden. Dictation and the typeahead pick call `setNotes` exactly as a
 * keystroke does, so they ride the same timer.
 */
import type * as Y from 'yjs';
import { findingKey } from '../../../server/lib/finding-key';
import type { ResultMap } from './results-binding';
import { setNotes as bindingSetNotes } from './results-binding';

/** Quiet time after the last change before the note is written to the doc. */
const IDLE_MS = 600;

// Module-level on purpose: `useFindings` rebuilds the API on every render, so a
// timer held in that closure would never be the one the next keystroke clears.
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; write: () => void }>();

function flush(id: string): void {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    p.write();
}

function flushAll(): void {
    for (const id of [...pending.keys()]) flush(id);
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushAll();
    });
}

export function buildNotesWrites(
    doc: Y.Doc,
    setResults: (fn: (prev: ResultMap) => ResultMap) => void,
    setDirty: (v: boolean) => void,
    unit: string | null,
) {
    // `doc.guid` keeps two open docs from sharing a slot for the same finding key.
    const idOf = (sectionId: string, itemId: string): string => `${doc.guid}|${findingKey(unit, sectionId, itemId)}`;

    // Phase U (Batch C1): the bare `itemId` slot holds only ONE unit's entry, so
    // we only mirror the echo there in the common scope (`unit == null`) — the
    // legacy dual-key read pattern. Under a real unit the composite key IS what
    // the read resolvers consult, so writing the shared bare slot would leak this
    // unit's optimistic notes into another unit that lacks a composite entry.
    const setNotes = (sectionId: string, itemId: string, notes: string): void => {
        const key = findingKey(unit, sectionId, itemId);
        setResults((prev) => {
            const bare = unit == null ? ((prev[itemId] as Record<string, unknown>) || {}) : {};
            const merged = {
                ...((prev[key] as Record<string, unknown>) || {}),
                ...bare,
                notes,
            };
            return unit == null
                ? { ...prev, [key]: merged, [itemId]: merged }
                : { ...prev, [key]: merged };
        });
        const id = idOf(sectionId, itemId);
        clearTimeout(pending.get(id)?.timer);
        pending.set(id, {
            timer: setTimeout(() => flush(id), IDLE_MS),
            write: () => bindingSetNotes(doc, sectionId, itemId, notes, unit),
        });
        setDirty(true);
    };

    const commitNotes = (sectionId: string, itemId: string, notes: string): void => {
        const id = idOf(sectionId, itemId);
        clearTimeout(pending.get(id)?.timer);
        pending.delete(id);
        bindingSetNotes(doc, sectionId, itemId, notes, unit);
        setDirty(true);
    };

    /**
     * Write a note still waiting on the idle timer. Call before any other write
     * to the same finding's notes (append, clone) so the timer cannot land after
     * it and put the older text back.
     */
    const flushNotes = (sectionId: string, itemId: string): void => flush(idOf(sectionId, itemId));

    return { setNotes, commitNotes, flushNotes };
}
