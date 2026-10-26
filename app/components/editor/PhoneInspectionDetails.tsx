import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Icon } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { loader as peopleLoader } from "~/routes/resources/inspection-people";
import type { loader as isnLoader } from "~/routes/resources/isn-card";

const HEADING = "mx-1 mt-3 mb-2 text-[14px] font-bold uppercase tracking-[0.08em] text-ih-fg-3";
const CARD = "bg-ih-bg-card border border-ih-border-strong rounded-lg";
const BTN = "w-12 h-12 shrink-0 rounded-md border border-ih-border-strong flex items-center justify-center text-ih-fg-1";

/**
 * The top of the phone's Inspection details screen (canvas S03): who to call and
 * how to get in, above the property facts form the desktop shares. Access comes
 * from the ISN order (the only place OI keeps a gate code), so an inspection
 * that did not come from ISN shows no Access block rather than an empty one.
 */
export function PhoneInspectionDetails({ inspectionId }: { inspectionId: string }) {
    const people = useFetcher<typeof peopleLoader>();
    const isn = useFetcher<typeof isnLoader>();
    const [codeShown, setCodeShown] = useState(false);
    useEffect(() => {
        const q = `?inspectionId=${encodeURIComponent(inspectionId)}`;
        void people.load(`/resources/inspection-people${q}`);
        void isn.load(`/resources/isn-card${q}`);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per inspection
    }, [inspectionId]);

    const access = isn.data;
    const status = access && [
        access.occupied === null ? null : access.occupied ? m.editor_details_occupied() : m.editor_details_vacant(),
        access.utilitiesOn === null ? null : access.utilitiesOn ? m.editor_details_utilities_on() : m.editor_details_utilities_off(),
    ].filter(Boolean).join(" · ");

    return (
        <div data-testid="phone-inspection-details" className="mb-4">
            <h2 className={HEADING}>{m.editor_details_people()}</h2>
            {people.data && (people.data.length ? (
                <ul className={CARD}>
                    {people.data.map((p) => {
                        const tel = p.phone?.replace(/[^\d+]/g, "");
                        return (
                            <li key={p.id} className="min-h-18 flex items-center gap-2 py-2 pr-2 pl-3.5 border-b border-ih-border last:border-b-0">
                                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                                    <span className="text-[14px] font-semibold text-ih-fg-3">{p.agency ? `${p.roleLabel} · ${p.agency}` : p.roleLabel}</span>
                                    <span className="text-[18px] font-bold text-ih-fg-1 truncate">{p.name}</span>
                                </span>
                                {tel && (
                                    <>
                                        <a href={`tel:${tel}`} aria-label={m.editor_details_call({ name: p.name })} className={BTN}><Icon name="phone" size={22} /></a>
                                        <a href={`sms:${tel}`} aria-label={m.editor_details_text({ name: p.name })} className={BTN}><Icon name="message" size={22} /></a>
                                    </>
                                )}
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p className={`${CARD} px-3.5 py-3 text-[16px] text-ih-fg-3`}>{m.editor_details_no_people()}</p>
            ))}

            {access && (access.accessCode || status) && (
                <>
                    <h2 className={HEADING}>{m.editor_details_access()}</h2>
                    <div className={CARD}>
                        {access.accessCode && (
                            <div className="min-h-15 flex items-center gap-2.5 py-1.5 pr-2 pl-3.5 border-b border-ih-border last:border-b-0">
                                <Icon name="lock" size={22} className="text-ih-fg-1" />
                                <span className="flex-1 text-[17px] text-ih-fg-1">{m.editor_details_access_code()}</span>
                                <button
                                    type="button"
                                    aria-pressed={codeShown}
                                    onClick={() => setCodeShown((v) => !v)}
                                    className="min-w-28 h-12 px-3 rounded-md border border-ih-border-strong text-[16px] font-bold tabular-nums text-ih-fg-1"
                                >
                                    {codeShown ? access.accessCode : m.editor_details_show_code()}
                                </button>
                            </div>
                        )}
                        {status && <div className="min-h-13 flex items-center px-3.5 py-1.5 text-[16px] text-ih-fg-3">{status}</div>}
                    </div>
                </>
            )}
        </div>
    );
}
