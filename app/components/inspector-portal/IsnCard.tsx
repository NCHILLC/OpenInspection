import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Card } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { loader } from "~/routes/resources/isn-card";

/**
 * The ISN card: what the ISN order says that OI keeps nowhere else (access
 * code, occupancy, paid/signed in ISN, ...). Read-only, ISN owns it. Renders
 * nothing for an inspection that did not come from ISN. One component for the
 * inspection page and the editor's settings sheet, so the inspector has the
 * access code at the door.
 */
export function IsnCard({ inspectionId }: { inspectionId: string }) {
    const fetcher = useFetcher<typeof loader>();
    useEffect(() => {
        fetcher.load(`/resources/isn-card?inspectionId=${encodeURIComponent(inspectionId)}`);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per inspection
    }, [inspectionId]);
    const d = fetcher.data;
    if (!d) return null;
    const yn = (v: boolean | null) => (v === null ? null : v ? m.inspections_isn_card_yes() : m.inspections_isn_card_no());
    const rows: Array<[string, string | null]> = [
        [m.inspections_isn_card_order(), d.orderNumber],
        [m.inspections_isn_card_access(), d.accessCode],
        [m.inspections_isn_card_occupied(), yn(d.occupied)],
        [m.inspections_isn_card_utilities(), yn(d.utilitiesOn)],
        [m.inspections_isn_card_cross_streets(), d.crossStreets],
        [m.inspections_isn_card_paid(), yn(d.paid)],
        [m.inspections_isn_card_signed(), yn(d.signed)],
        [m.inspections_isn_card_report_number(), d.reportNumber],
        [m.inspections_isn_card_policy_holder(), d.policyHolder],
        [m.inspections_isn_card_policy_number(), d.policyNumber],
    ];
    return (
        <Card className="p-5" data-testid="isn-card">
            <h3 className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{m.inspections_isn_card_title()}</h3>
            {d.canceled && <p className="mt-1 text-[13px] font-bold text-ih-bad-fg">{m.inspections_isn_card_canceled()}</p>}
            <dl className="mt-3 space-y-2">
                {rows.filter(([, v]) => v).map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 text-[13px]">
                        <dt className="text-ih-fg-3 shrink-0">{label}</dt>
                        <dd className="text-ih-fg-1 font-medium text-right">{value}</dd>
                    </div>
                ))}
            </dl>
            <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
                {d.directionsUrl
                    ? <a href={d.directionsUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-ih-primary">{m.inspections_isn_card_directions()}</a>
                    : <span />}
                {d.orderUrl
                    ? <a href={d.orderUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-ih-primary">{m.inspections_isn_card_open_in_isn()}</a>
                    : <span className="text-ih-fg-3">{m.inspections_isn_card_change_in_isn()}</span>}
            </div>
        </Card>
    );
}
