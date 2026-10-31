/**
 * Runs the field log for a user whose setting is on: records screen opens and,
 * in the editor, offers Mark issue. The setting is cached on the device so the
 * recorder still runs when an inspection opens with no signal.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button } from "@core/shared-ui";
import {
  FIELD_LOG_RESOURCE,
  flushFieldLog,
  inspectionIdFromPath,
  installFieldLog,
  isFieldLogOn,
  logFieldEvent,
  setFieldLogOn,
} from "~/lib/field-log";
import { m } from "~/paraglide/messages";

export function FieldLogRecorder() {
  const { pathname, search } = useLocation();
  const inspectionId = inspectionIdFromPath(pathname);
  const [on, setOn] = useState(false);
  const [marking, setMarking] = useState(false);
  const [note, setNote] = useState("");
  const inEditor = /\/edit$/.test(pathname);

  useEffect(() => {
    if (!inspectionId) return;
    setOn(isFieldLogOn());
    void fetch(FIELD_LOG_RESOURCE)
      .then((res) => (res.ok ? (res.json() as Promise<{ enabled: boolean }>) : null))
      .then((body) => {
        if (!body) return;
        setFieldLogOn(body.enabled);
        setOn(body.enabled);
      })
      .catch(() => undefined);
  }, [inspectionId]);

  useEffect(() => {
    if (!on) return;
    installFieldLog();
    const params = new URLSearchParams(search);
    const item = params.get("item");
    const section = params.get("section");
    const screen = item ? `item:${item}` : section ? `section:${section}` : inEditor ? "editor" : "screen";
    logFieldEvent("screen", screen, { route: pathname });
  }, [on, pathname, search, inEditor]);

  if (!on || !inEditor) return null;

  const save = () => {
    const trimmed = note.trim();
    logFieldEvent("issue", "mark_issue", trimmed ? { note: trimmed.slice(0, 500) } : {});
    void flushFieldLog();
    setNote("");
    setMarking(false);
  };

  return (
    <div className="fixed bottom-24 left-2 z-40 print:hidden">
      {marking ? (
        <div className="w-72 max-w-[calc(100vw-1rem)] space-y-2 rounded-lg border border-ih-border bg-ih-bg-card p-3 shadow-ih-card">
          <textarea
            autoFocus
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={m.inspections_field_log_mark_placeholder()}
            placeholder={m.inspections_field_log_mark_placeholder()}
            className="w-full rounded border border-ih-border bg-ih-bg-app p-2 text-sm text-ih-fg-1"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save}>{m.inspections_field_log_save()}</Button>
            <Button size="sm" variant="ghost" onClick={() => setMarking(false)}>{m.inspections_field_log_cancel()}</Button>
            <Link to={`/inspections/${inspectionId}/field-log`} className="ml-auto text-xs text-ih-fg-2 underline">
              {m.inspections_field_log_title()}
            </Link>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setMarking(true)}>{m.inspections_field_log_mark()}</Button>
      )}
    </div>
  );
}
