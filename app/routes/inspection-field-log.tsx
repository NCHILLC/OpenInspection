/**
 * `/inspections/:id/field-log` — what happened on the phone, oldest first, with
 * Mark issue markers standing out. Read only. Docs: docs/operate/field-log.md.
 */
import { useLoaderData } from "react-router";
import type { Route } from "./+types/inspection-field-log";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { EmptyState, PageHeader } from "@core/shared-ui";
import { formatInspectionDateTime } from "~/lib/format-date";
import { useDisplayTimeZone, useInspectionDateTimeFormat } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.inspections_field_log_meta_title() }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const res = await createApi(context, { token }).fieldLog.inspections[":id"].$get({ param: { id: params.id } });
  if (!res.ok) throw new Response(null, { status: res.status });
  return res.json();
}

export default function InspectionFieldLog() {
  const { events } = useLoaderData<typeof loader>();
  const displayTz = useDisplayTimeZone();
  const fmt = useInspectionDateTimeFormat();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader title={m.inspections_field_log_title()} />
      {events.length === 0 ? (
        <EmptyState title={m.inspections_field_log_empty()} />
      ) : (
        <ol className="divide-y divide-ih-border text-sm">
          {events.map((e) => (
            <li key={e.id} className={`flex flex-wrap gap-x-3 py-1.5 ${e.kind === "issue" ? "font-semibold text-ih-fg-1" : "text-ih-fg-2"}`}>
              <time dateTime={new Date(e.occurredAt).toISOString()} className="tabular-nums">
                {formatInspectionDateTime(new Date(e.occurredAt).toISOString(), undefined, displayTz, fmt)}
              </time>
              <span>{e.kind === "issue" ? m.inspections_field_log_issue() : e.kind}</span>
              <span>{e.name}</span>
              {e.status !== null && <span>{e.status}</span>}
              {e.route && <span className="break-all">{e.route}</span>}
              {e.note && <span className="w-full">{e.note}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
