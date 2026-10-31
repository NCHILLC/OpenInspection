import { useEffect, useState } from "react";
import { FIELD_LOG_RESOURCE, setFieldLogOn } from "~/lib/field-log";
import { m } from "~/paraglide/messages";

/** The user's own field log switch. Off until they turn it on. */
export function FieldLogCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch(FIELD_LOG_RESOURCE)
      .then((res) => (res.ok ? (res.json() as Promise<{ enabled: boolean }>) : null))
      .then((body) => setEnabled(body?.enabled ?? null))
      .catch(() => undefined);
  }, []);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    const res = await fetch(FIELD_LOG_RESOURCE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null);
    if (res?.ok) setFieldLogOn(next);
    else setEnabled(!next);
  };

  return (
    <section className="rounded-lg border border-ih-border bg-ih-bg-card p-4">
      <label className="flex items-center gap-3 text-sm font-medium text-ih-fg-1">
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={enabled === null}
          onChange={(e) => void toggle(e.target.checked)}
        />
        {m.inspections_field_log_card_toggle()}
      </label>
      <p className="mt-1 text-xs text-ih-fg-2">{m.inspections_field_log_card_help()}</p>
    </section>
  );
}
