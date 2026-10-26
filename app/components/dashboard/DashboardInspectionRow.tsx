import { Link } from "react-router";
import { formatInspectionDateTime } from "~/lib/format-date";
import { INSPECTION_STATUS, isReportPublished, statusTone } from "~/lib/status";
import { reportStateLabel } from "~/lib/dashboard-filters";
import { REPORT_STATE_TONE, type Inspection } from "~/lib/dashboard-schema";
import { Pill, Icon } from "@core/shared-ui";
import { RestoreInspectionAction } from "~/components/RestoreInspectionAction";
import { m } from "~/paraglide/messages";
import { formatDollars } from "~/lib/money";
import { useDisplayLocale, useDisplayCurrency, useTenantFormatPrefs } from "~/hooks/useSessionContext";

interface DashboardInspectionRowProps {
  insp: Inspection;
  reportView?: boolean;
  tenantSlug: string | null;
  selectedIds: Set<string>;
  isColumnVisible: (id: string) => boolean;
  toggleSelect: (id: string) => void;
  transitionStatus: (id: string, status: string) => void;
  /** Viewer's effective zone (useDisplayTimeZone in the owning route). Required:
   *  an omitted zone renders scheduled times in whatever zone the browser is in. */
  timeZone: string;
}

/* ---- Render inspection row ---- */
// reportView=true on the Published tab: render a report-state badge and, for
// delivered/published rows, a "View report" deep-link into the public report.
export function DashboardInspectionRow({
  insp,
  reportView = false,
  tenantSlug,
  selectedIds,
  isColumnVisible,
  toggleSelect,
  transitionStatus,
  timeZone,
}: DashboardInspectionRowProps) {
  const locale = useDisplayLocale();
  const currency = useDisplayCurrency();
  const shape = useTenantFormatPrefs();
  const isSelected = selectedIds.has(insp.id);
  const cancelled = insp.status === INSPECTION_STATUS.CANCELLED;
  const showReportLink =
    reportView && tenantSlug && isReportPublished(insp.reportStatus);
  const address = insp.address || insp.propertyAddress || m.dashboard_row_no_address();
  const when = insp.date ? formatInspectionDateTime(insp.date, undefined, timeZone, { locale, ...shape }) : null;
  const findings = insp.defectStats ? insp.defectStats.safety + insp.defectStats.recommendation + insp.defectStats.maintenance : 0;
  // Shared by both layouts below: a warning only, it gates nothing.
  const isnPills = insp.isn && (
    <>
      {(insp.isn.unmatchedServices.length > 0 || insp.isn.unmatchedInspectors > 0) && (
        <span title={insp.isn.unmatchedServices.join(", ")}>
          <Pill tone="warning">
            {m.dashboard_row_isn_unmatched({ services: insp.isn.unmatchedServices.length, inspectors: insp.isn.unmatchedInspectors })}
          </Pill>
        </span>
      )}
      {/* S3 conflict: cancelled in ISN, kept in OI because the report has writing. */}
      {insp.isn.canceledInIsn && !cancelled && <Pill tone="defect">{m.dashboard_row_isn_cancelled_kept()}</Pill>}
    </>
  );
  return (
    <div className="flex items-center gap-2 px-4 py-3 hover:bg-ih-bg-muted transition-colors group">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => toggleSelect(insp.id)}
        className="accent-ih-primary shrink-0"
      />
      <Link to={`/inspections/${insp.id}`} className="flex-1 min-w-0">
        {/* Below sm, a card (canvas S01): when and its status, then where in
            large type, then what is wrong. The side-by-side row below is a
            desktop-width layout: on a phone its `shrink-0` pill group left the
            address a few characters and wrapped "9:00 AM EDT" over four lines. */}
        <div className="sm:hidden flex flex-col gap-2 py-1">
          <span className="flex items-center gap-2">
            {when && <span className="text-[15px] font-bold text-ih-fg-2 tabular-nums whitespace-nowrap">{when}</span>}
            <Pill tone={statusTone(insp.status)}>{insp.status.replace(/_/g, " ")}</Pill>
            <span className="flex-1" />
            <Icon name="chevR" size={22} className="text-ih-fg-4" />
          </span>
          <span className="font-ih-display text-[22px] font-bold leading-tight text-ih-fg-1">{address}</span>
          <span className="text-[15px] text-ih-fg-3">{[insp.clientName || m.dashboard_row_no_client(), insp.agentName].filter(Boolean).join(" · ")}</span>
          {(findings > 0 || isnPills) && (
            <span className="flex flex-wrap items-center gap-2">
              {findings > 0 && (
                <span className="flex items-center gap-1.5 text-[15px] text-ih-bad-fg">
                  <span className="w-2 h-2 rounded-full bg-ih-bad" aria-hidden="true" />
                  {m.editor_shared_section_findings({ count: findings, s: findings === 1 ? "" : "s" })}
                </span>
              )}
              {isnPills}
            </span>
          )}
        </div>
        <div className="hidden sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          {isColumnVisible("propertyAddress") && (
            <p className="text-[13px] font-medium text-ih-fg-1 truncate">
              {address}
            </p>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {isColumnVisible("clientName") && (
              <span className="text-[11px] text-ih-fg-3">
                {insp.clientName || m.dashboard_row_no_client()}
              </span>
            )}
            {isColumnVisible("date") && insp.date && (
              <span className="text-[11px] text-ih-fg-3">
                &middot; {when}
              </span>
            )}
            {isColumnVisible("agent") && insp.agentName && (
              <span className="text-[11px] text-ih-fg-3">
                &middot; {insp.agentName}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0 sm:ml-4">
          {isColumnVisible("statusIcons") && (
            <Pill tone={statusTone(insp.status)}>
              {insp.status.replace(/_/g, " ")}
            </Pill>
          )}
          {/* report-state badge (Published/to_review tabs) */}
          {reportView && insp.reportStatus && REPORT_STATE_TONE[insp.reportStatus] && (
            <Pill tone={REPORT_STATE_TONE[insp.reportStatus]}>
              {reportStateLabel(insp.reportStatus)}
            </Pill>
          )}
          {isColumnVisible("defectChips") && insp.defectStats && (
            <div className="flex gap-1">
              {insp.defectStats.safety > 0 && (
                <Pill tone="defect">{insp.defectStats.safety}S</Pill>
              )}
              {insp.defectStats.recommendation > 0 && (
                <Pill tone="monitor">{insp.defectStats.recommendation}R</Pill>
              )}
              {insp.defectStats.maintenance > 0 && (
                <Pill tone="info">{insp.defectStats.maintenance}M</Pill>
              )}
            </div>
          )}
          {/* P-4: `price` is the full authority chain — invoice, else the service
              snapshots, else the cached column — resolved server-side in
              getDashboardBuckets (IA-131). It arrives in integer CENTS, like every
              other `_cents` value, so it must be formatted rather than
              interpolated. This rendered `${insp.price}` raw for as long as it did
              because the cache tier reads 0 on real data: "$0" looks the same
              whichever unit you think it is in, and fixing the source is what
              turned it into "$45000". */}
          {isnPills}
          {isColumnVisible("price") && insp.price != null && (
            <span className="text-[11px] font-medium text-ih-fg-3">
              {formatDollars(insp.price, { locale, currency })}
            </span>
          )}
        </div>
        </div>
      </Link>
      {/* Hover actions: open editor + status transition (visible on hover) */}
      {/* Hidden below sm: touch has no hover, so these sat invisible but tappable. */}
      <div className="max-sm:hidden opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center gap-1.5">
        <Link
          to={`/inspections/${insp.id}/edit`}
          aria-label={m.dashboard_row_open_editor()}
          title={m.dashboard_row_open_editor()}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center h-6 w-6 rounded text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-fg-1"
        >
          <Icon name="edit" size={14} />
        </Link>
        {/* #111: deep-link into the public report (Published tab, delivered/published only) */}
        {showReportLink && (
          <Link
            to={`/report-view/${tenantSlug}/${insp.id}`}
            aria-label={m.dashboard_row_view_report()}
            title={m.dashboard_row_view_report()}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center h-6 w-6 rounded text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-fg-1"
          >
            <Icon name="share" size={14} />
          </Link>
        )}
        {/* #78 — NO "Cancelled" TO PICK. This dropdown PATCHes the status
            straight onto the inspection, which skips the fee ladder, the
            refund and the recorded reason that only `POST /:id/cancel`
            performs — so a cancellation taken from here left the money saying
            the job was still on. Cancelling lives on the inspection's own
            Lifecycle card, behind the priced confirmation. The API refuses this
            write regardless; the option is gone so the UI stops offering a door
            the server has closed.

            #81 — AND A CANCELLED ROW GETS NO DROPDOWN AT ALL, for the mirror
            reason. Leaving `cancelled` used to be a plain status write here,
            which was the product's ONLY recovery and did less than the endpoint
            built for the job: `POST /:id/uncancel` also restores the calendar
            entry. That endpoint is the one door now and this write refuses, so
            the cancelled cluster below shows the status and offers the button
            instead of four options the server would reject. */}
        {!cancelled && (
          <select
            value={insp.status}
            onChange={(e) => transitionStatus(insp.id, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="h-6 px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-2 border-0 outline-none cursor-pointer"
          >
            <option value="requested">{m.dashboard_row_status_requested()}</option>
            <option value="scheduled">{m.dashboard_row_status_scheduled()}</option>
            <option value="confirmed">{m.dashboard_row_status_confirmed()}</option>
            <option value="completed">{m.dashboard_row_status_completed()}</option>
          </select>
        )}
      </div>
      {/* OUTSIDE the hover group, and that is load-bearing twice over. The
          restore control carries a confirmation Modal, which renders INLINE
          rather than through a portal — an ancestor at `opacity-0` would both
          hide it and become the containing block its `fixed inset-0` backdrop
          resolves against, so the dialog would vanish the moment the pointer
          left the row. It is also the point of #81 that recovery is findable:
          a hover-only affordance is what made the old one undiscoverable. */}
      {cancelled && (
        <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <select
            value={insp.status}
            disabled
            aria-label={m.dashboard_row_status_cancelled()}
            className="h-6 px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-2 border-0 outline-none disabled:opacity-100"
          >
            <option value="cancelled">{m.dashboard_row_status_cancelled()}</option>
          </select>
          <RestoreInspectionAction
            inspectionId={insp.id}
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
          />
        </div>
      )}
    </div>
  );
}
