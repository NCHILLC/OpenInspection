import { Form, useFetcher } from "react-router";
import { SecretField } from "~/components/SecretField";
import { TestConnectionButton } from "~/components/settings/TestConnectionButton";
import { ConnectionTestStatus, type ConnectionTestResult } from "~/components/settings/ConnectionTestStatus";
import { m } from "~/paraglide/messages";

export const ISN_SECRET_KEYS = ["ISN_DOMAIN", "ISN_COMPANY_KEY", "ISN_ACCESS_KEY", "ISN_SECRET_KEY"] as const;
export type IsnSecrets = Record<(typeof ISN_SECRET_KEYS)[number], string>;

interface IsnPanelProps {
  secrets: IsnSecrets;
  /** The webhook secret is set, which is what turns ISN intake on. */
  intakeOn: boolean;
  testResults?: ConnectionTestResult[];
  fieldError: (name: string) => string | undefined;
  saving: boolean;
}

/** ISN (Inspection Support Network): the company's credentials. */
export function IsnPanel({ secrets, intakeOn, testResults = [], fieldError, saving }: IsnPanelProps) {
  // Its own fetcher: the result stays in this panel instead of the page's save flash.
  const pull = useFetcher<{ success: boolean; error: string | null; pull?: { processed: number; failed: number; nextCursor: string | null } }>();
  const test = useFetcher<{ intent: string; success: boolean; error: string | null; isnTest?: { intakeOn: boolean } }>();
  const pulled = pull.state === "idle" ? pull.data : undefined;
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_isn_heading()}</h3>
      <p className="text-[13px] text-ih-fg-3">{m.settings_isn_desc()}</p>
      <Form method="post" className="space-y-4 max-w-xl">
        <input type="hidden" name="intent" value="save-isn" />
        <SecretField name="ISN_DOMAIN" type="text" label={m.settings_isn_domain_label()} value={secrets.ISN_DOMAIN}
          error={fieldError("ISN_DOMAIN")} hint={m.settings_isn_domain_hint()} />
        <SecretField name="ISN_COMPANY_KEY" type="text" label={m.settings_isn_company_key_label()} value={secrets.ISN_COMPANY_KEY}
          error={fieldError("ISN_COMPANY_KEY")} hint={m.settings_isn_keys_hint()} />
        <SecretField name="ISN_ACCESS_KEY" label={m.settings_isn_access_key_label()} value={secrets.ISN_ACCESS_KEY}
          error={fieldError("ISN_ACCESS_KEY")} />
        <SecretField name="ISN_SECRET_KEY" label={m.settings_isn_secret_key_label()} value={secrets.ISN_SECRET_KEY}
          error={fieldError("ISN_SECRET_KEY")} />
        <div className="flex justify-end pt-2 border-t border-ih-border">
          <button type="submit" disabled={saving}
            className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            {saving ? m.common_saving() : m.common_save()}
          </button>
        </div>
      </Form>
      <p className={`text-[13px] ${intakeOn ? "text-ih-ok-fg" : "text-ih-fg-3"}`}>
        {intakeOn ? m.settings_isn_intake_on() : m.settings_isn_intake_off()}
      </p>
      <TestConnectionButton fetcher={test} intent="test-isn">
        {test.state === "idle" && test.data?.intent === "test-isn" && (
          test.data.success
            ? <span className="text-[12px] text-ih-ok-fg">{m.settings_isn_test_ok()}</span>
            : <span className="text-[12px] text-ih-bad-fg">{test.data.error}</span>
        )}
      </TestConnectionButton>
      <ConnectionTestStatus results={testResults} target="isn" />
      <pull.Form method="post" className="space-y-3 max-w-xl pt-4 border-t border-ih-border">
        <input type="hidden" name="intent" value="pull-isn" />
        <input type="hidden" name="cursor" value={pulled?.pull?.nextCursor ?? ""} />
        <p className="text-[13px] text-ih-fg-3">{m.settings_isn_pull_desc()}</p>
        <button type="submit" disabled={pull.state !== "idle"}
          className="h-9 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 font-bold text-[13px] hover:bg-ih-bg-muted active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
          {pull.state !== "idle" ? m.settings_isn_pull_pulling() : m.settings_isn_pull_button()}
        </button>
        {pulled && (
          <p role="status" className={`text-[13px] ${pulled.success && !pulled.pull?.failed ? "text-ih-fg-2" : "text-ih-bad-fg"}`}>
            {pulled.pull
              ? pulled.pull.failed
                ? m.settings_isn_pull_failed({ count: pulled.pull.processed, failed: pulled.pull.failed })
                : pulled.pull.nextCursor
                  ? m.settings_isn_pull_more({ count: pulled.pull.processed })
                  : m.settings_isn_pull_done({ count: pulled.pull.processed })
              : pulled.error}
          </p>
        )}
      </pull.Form>
    </section>
  );
}
