/**
 * The ISN panel's load, kept out of settings-advanced.tsx so the route stays
 * a list of panels. The save shares that route's one module-private
 * `putSecretsSubset` call into the encrypted secrets store (PUT
 * /api/secrets) with the other advanced-settings panels, instead of this
 * module making its own — see the fan-out budget note on `putSecretsSubset`
 * in app/routes/settings-advanced.tsx and scripts/check-middleware-budget.mjs.
 */
import { ISN_SECRET_KEYS, type IsnSecrets } from "~/components/settings/advanced/IsnPanel";

export function loadIsnSettings(secrets: Record<string, string>): IsnSecrets {
  return Object.fromEntries(ISN_SECRET_KEYS.map((k) => [k, secrets[k] || ""])) as IsnSecrets;
}

/**
 * Whether ISN intake is switched on: the webhook secret is set. Only presence
 * leaves the server (the secrets API masks the value); the keys alone just
 * send report links.
 */
export function isnIntakeOn(secrets: Record<string, string>): boolean {
  return !!secrets.ISN_WEBHOOK_SECRET;
}
