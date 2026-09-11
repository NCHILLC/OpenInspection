/**
 * B-21 — New Inspection wizard step plan + date default.
 *
 * Steps with nothing to decide are skipped instead of rendered as empty
 * placeholders the inspector has to click through: Services disappears when
 * the tenant has no service catalog. The Schedule date defaults to "today" in
 * the inspector's local timezone — on-site creation is overwhelmingly same-day.
 *
 * Batch D — Schedule and Team were each one decision on a step of their own (a
 * date field; a two-way radio), and whichever came last was where "Create"
 * lived, so the wizard ended without ever stating what it was about to create.
 * They are now one `confirm` step: both controls, plus a review of every earlier
 * answer. An empty team hides a control inside that step rather than removing a
 * step, which is why `hasTeamChoices` is gone.
 */

import { m } from '~/paraglide/messages';

export type WizardStepId = 'property' | 'people' | 'services' | 'confirm';

/** Everything the step gate reads, flattened so the rule is pure. */
export interface StepGateState {
  address: string;
  templateId: string;
  clientNameMissing: boolean;
  /** Non-empty and not shaped like an email. `type="email"` never runs its
   *  own constraint check because Next is a button, not a form submit — which
   *  is true of BOTH email fields on this step, so both are gated. */
  clientEmailInvalid: boolean;
  agentEmailInvalid: boolean;
  serviceCount: number;
  date: string;
  holidayBlocked: boolean;
}

/**
 * Why the wizard will not move on — or null when it will.
 *
 * `Next` used to be disabled with nothing said. On Property it greys out until
 * BOTH an address and a template are set, and on Services until a service is
 * ticked, so the inspector is left comparing a dead button against a form that
 * looks filled in. A disabled control has to name its own condition; that is the
 * whole reason this returns a sentence instead of a boolean.
 *
 * Order matters: the reason names the FIRST thing to fix, reading down the step.
 */
export function stepBlockedReason(step: WizardStepId, s: StepGateState): string | null {
  switch (step) {
    case 'property':
      // propertyAddress has a min(5) server constraint — enforce it here so the
      // wizard cannot advance into an inevitable 400.
      if (s.address.trim().length < 5) return m.newinsp_gate_address();
      if (s.templateId.length === 0) return m.newinsp_gate_template();
      return null;
    case 'people':
      // People is optional as a whole, but a contact detail with no name is not
      // a person, and a malformed email is not an email.
      if (s.clientNameMissing) return m.newinsp_gate_client_name();
      // One sentence serves both fields: it names the fix, not the field.
      if (s.clientEmailInvalid || s.agentEmailInvalid) return m.newinsp_gate_client_email();
      return null;
    case 'services':
      return s.serviceCount === 0 ? m.newinsp_gate_service() : null;
    case 'confirm':
      if (s.date.length === 0) return m.newinsp_gate_date();
      if (s.holidayBlocked) return m.newinsp_gate_holiday();
      return null;
  }
}

/**
 * Whether Next/Create may fire while looking at `atStep` — every step up to
 * and including it must be clear, not just the one on screen. A ReviewPanel
 * row can jump straight to `confirm`, whose own gate only knows about date
 * and holiday; reading `stepBlockedReason` for just the landed-on step is
 * what let Create go live over an address that was never entered. This is
 * the one function both the Next/Create button and a review-panel jump read.
 */
export function wizardBlockedReason(steps: WizardStepId[], atStep: WizardStepId, s: StepGateState): string | null {
  for (const step of steps) {
    const reason = stepBlockedReason(step, s);
    if (reason) return reason;
    if (step === atStep) break;
  }
  return null;
}

/** A minimal local@domain.tld shape — what `type="email"` would enforce if
 *  Next were a form submit. Not the server's authoritative check, which
 *  still runs; this only stops an obvious typo from reaching it. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

export function buildWizardSteps(opts: {
  hasServiceCatalog: boolean;
}): WizardStepId[] {
  const steps: WizardStepId[] = ['property'];
  // IA-1 — People (client + agent) is always present: capturing who is
  // involved is useful for any inspection regardless of catalog or team size.
  steps.push('people');
  if (opts.hasServiceCatalog) steps.push('services');
  steps.push('confirm');
  return steps;
}


/**
 * FE-7 — services.price is stored in cents (see services schema comment);
 * render it like every other consumer ($X.XX), not as the raw integer.
 */
export function formatPriceCents(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}
