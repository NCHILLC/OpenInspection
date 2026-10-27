import { useEffect } from "react";
import { useFetcher } from "react-router";
import { m } from "~/paraglide/messages";
import { getLocale } from "~/paraglide/runtime";
import type { loader as peopleLoader } from "~/routes/resources/inspection-people";
import { todayInZone } from "~/lib/civil-time";
import { useDisplayTimeZone } from "~/hooks/useSessionContext";

export interface InspectionHeroProps {
  inspectionId: string;
  address: string;
  date: string;
  city?: string | null;
  yearBuilt?: number | null;
}

/**
 * "Today · 9:00 AM" / "Tue, Oct 28 · 2:30 PM". A date with a time is a UTC
 * instant (the booking form stores it through civilToInstantISO), so its day and
 * time are read in the viewer's zone; a bare YYYY-MM-DD is a calendar day.
 */
export function heroEyebrow(date: string, now: Date, locale?: string, timeZone = "UTC"): string {
  const hasTime = date.includes("T");
  // tz-lint-ok: a bare YYYY-MM-DD is a calendar day; pinning it to UTC keeps it that day.
  const instant = new Date(hasTime ? date : `${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(instant.getTime())) return "";
  const zone = hasTime ? timeZone : "UTC";
  const dayPart = todayInZone(zone, instant) === todayInZone(timeZone, now)
    ? m.editor_hero_today()
    : new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: zone }).format(instant);
  if (!hasTime) return dayPart;
  // Midnight in the viewer's zone means the booking carried no time.
  const hhmm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(instant);
  if (hhmm === "00:00") return dayPart;
  return `${dayPart} · ${new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone }).format(instant)}`;
}

export function InspectionHero({
  inspectionId,
  address,
  date,
  city,
  yearBuilt,
}: InspectionHeroProps) {
  const timeZone = useDisplayTimeZone();
  const people = useFetcher<typeof peopleLoader>();
  useEffect(() => {
    const q = `?inspectionId=${encodeURIComponent(inspectionId)}`;
    void people.load(`/resources/inspection-people${q}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per inspectionId
  }, [inspectionId]);

  const clientName = people.data?.find((p) => p.kind === "client")?.name ?? null;

  const sublineParts = [
    clientName,
    city || null,
    yearBuilt ? m.editor_template_built({ year: yearBuilt }) : null,
  ].filter((v): v is string => Boolean(v));

  return (
    <section data-testid="inspection-hero" className="px-1 pt-1 pb-4 flex flex-col gap-1.5">
      <div className="text-[14px] font-semibold uppercase tracking-[0.08em] text-ih-fg-3">
        {heroEyebrow(date, new Date(), getLocale(), timeZone)}
      </div>
      <h1 className="m-0 text-[30px] leading-[1.1] font-bold tracking-tight">{address}</h1>
      {sublineParts.length > 0 && (
        <div className="text-[16px] text-ih-fg-3">{sublineParts.join(" · ")}</div>
      )}
    </section>
  );
}
