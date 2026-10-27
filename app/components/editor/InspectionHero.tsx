import { useEffect } from "react";
import { useFetcher } from "react-router";
import { m } from "~/paraglide/messages";
import { getLocale } from "~/paraglide/runtime";
import type { loader as peopleLoader } from "~/routes/resources/inspection-people";

export interface InspectionHeroProps {
  inspectionId: string;
  address: string;
  date: string;
  city?: string | null;
  yearBuilt?: number | null;
}

export function heroEyebrow(date: string, now: Date, locale?: string): string {
  const day = date.slice(0, 10);
  const nowDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let dayPart: string;
  if (day === nowDay) {
    dayPart = m.editor_hero_today();
  } else {
    dayPart = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(day + "T00:00:00Z"));
  }
  if (date.includes("T")) {
    const timePart = date.split("T")[1];
    const hhmm = timePart.slice(0, 5);
    if (hhmm !== "00:00") {
      const timeStr = new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      }).format(new Date("1970-01-01T" + hhmm + ":00Z"));
      return `${dayPart} · ${timeStr}`;
    }
  }
  return dayPart;
}

export function InspectionHero({
  inspectionId,
  address,
  date,
  city,
  yearBuilt,
}: InspectionHeroProps) {
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
        {heroEyebrow(date, new Date(), getLocale())}
      </div>
      <h1 className="m-0 text-[30px] leading-[1.1] font-bold tracking-tight">{address}</h1>
      {sublineParts.length > 0 && (
        <div className="text-[16px] text-ih-fg-3">{sublineParts.join(" · ")}</div>
      )}
    </section>
  );
}
