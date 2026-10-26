import { m } from "~/paraglide/messages";

export interface InspectionProgressCardProps {
    rated: number;
    total: number;
    findings: number;
    photos: number;
    /** "Roof › Chimney": the first unrated item. Omitted once everything is rated. */
    upNext?: string;
}

/**
 * The phone inspection screen's summary (canvas S02): how far along, how much
 * is wrong, and where the work resumes. The bottom bar's ring says the same
 * percentage; this is the one place the counts behind it are written out.
 */
export function InspectionProgressCard({ rated, total, findings, photos, upNext }: InspectionProgressCardProps) {
    const pct = total > 0 ? Math.round((rated / total) * 100) : 0;
    return (
        <section
            aria-label={m.editor_shared_section_rated({ rated, total })}
            data-testid="inspection-progress-card"
            className="mb-3 px-4 py-3.5 bg-ih-bg-card border border-ih-border rounded-lg flex flex-col gap-2.5"
        >
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-[18px] font-bold">{m.editor_shared_section_rated({ rated, total })}</span>
                <span className="flex items-center gap-3.5 text-[16px]">
                    {findings > 0 && (
                        <span className="flex items-center gap-1.5 text-ih-bad-fg">
                            <span className="w-2 h-2 rounded-full bg-ih-bad" aria-hidden="true" />
                            {m.editor_shared_section_findings({ count: findings, s: findings === 1 ? "" : "s" })}
                        </span>
                    )}
                    <span className="text-ih-fg-3">{m.editor_mobile_photos({ count: photos, s: photos === 1 ? "" : "s" })}</span>
                </span>
            </div>
            <div
                role="progressbar"
                aria-label={m.editor_mobile_percent_complete({ percent: pct })}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 rounded bg-ih-bg-muted overflow-hidden"
            >
                <div className="h-full bg-ih-ok" style={{ width: `${pct}%` }} />
            </div>
            {upNext && (
                <div className="text-[15px] text-ih-fg-3">
                    {m.editor_mobile_up_next()} <span className="text-ih-fg-1 font-semibold">{upNext}</span>
                </div>
            )}
        </section>
    );
}
