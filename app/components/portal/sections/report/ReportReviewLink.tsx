/**
 * The Summary's link into the client's Cost Clarity Review on Data Driven Direction, NCHI's
 * client site (fork-only; docs/develop/fork-log.md). Renders nothing without a link, which is
 * every deployment that has not configured DDD and every commercial report (server/ddd/link.ts).
 *
 * Deliberately NOT `print:hidden`: the summary PDF is this page printed, and the link has to
 * be there, and clickable, in the PDF too.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { m } from "~/paraglide/messages";

export function ReportReviewLink({ href }: { href: string | null | undefined }) {
  if (!href) return null;
  return (
    <aside className="mb-8 rounded-xl border border-ih-border bg-ih-bg-card p-5 break-inside-avoid">
      <p className="text-base font-semibold text-ih-fg-1">{m.report_view_ccr_title()}</p>
      <p className="mt-1 text-sm text-ih-fg-3">{m.report_view_ccr_body()}</p>
      <a
        href={href}
        className="mt-3 inline-flex min-h-11 items-center rounded-full bg-ih-primary px-4 text-sm font-semibold text-ih-primary-fg"
      >
        {m.report_view_ccr_cta()}
      </a>
    </aside>
  );
}
