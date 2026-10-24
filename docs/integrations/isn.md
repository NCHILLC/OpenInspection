# ISN — report links on ISN orders

For companies that book and bill through ISN (Inspection Support Network) and
write reports here. When a report is published, its link is added to the ISN
order it belongs to, so the client and agent find it where ISN already sends
them.

This is the report half of
[InspectorHub/OpenInspection#321](https://github.com/InspectorHub/OpenInspection/issues/321).
Importing ISN's scheduled orders is in progress: the webhook receiver below
turns each changed order into an OI inspection. There is no catch-up sweep yet,
so an order ISN gave up retrying is not picked up.

## Order webhook

`POST /webhooks/isn` takes ISN's order webhooks. It checks `X-ISN-Signature`
against `ISN_WEBHOOK_SECRET`, then re-reads the order with `GET /order/{id}` and
stores ISN's answer in `isn_orders`. The webhook body is trusted only for which
order changed. A delivery with `"test": true` is acknowledged and not applied.

- No secret, no tenant, or a bad signature: 401. Nothing is read or written.
- The re-fetch fails: 500, so ISN retries (8 attempts over about a day).
- A repeated delivery re-reads the order again; the row holds ISN's latest state.

Each stored order is then applied to its inspection. ISN wins on schedule and
order facts:

- **First time:** an inspection is created at the order's date and time, status
  Scheduled, reference number = ISN's order number. It carries the address,
  year built, square feet, foundation, the client and both agents (as contacts),
  and the services. No booking-confirmation emails go out; ISN already sent them.
  An order already cancelled when OI first sees it is not created.
- **Every later delivery:** date, address, property facts and inspectors are
  rewritten from ISN. A cancel in ISN marks the inspection Cancelled, unless
  the report already has writing in it; then it is left alone and logged.
- **Inspectors** are matched by email: each ISN inspector's email
  (`GET /user/{id}`) must belong to an OI user. `inspector1` is the lead.
  Unmatched inspectors are logged and left off.
- **Services** are matched by name: an ISN service whose name equals an OI
  service's name (ignoring case and outer spaces) is added, and the first one
  with a template sets the inspection's template. Others are logged. Services
  are set at creation only.

To turn it on: create the webhook in ISN (Settings → Webhooks → Add Webhook,
POST, tracked and signed, URL `https://<this app's host>/webhooks/isn`), copy
the secret ISN shows once, set it as `ISN_WEBHOOK_SECRET` (a Worker secret, or
stored with the other ISN keys), then use ISN's "Send test event". The bare path
uses standalone's fixed tenant; SaaS has no per-tenant ISN webhook path.

## What you need

| Key | Where |
|---|---|
| `ISN_DOMAIN` | The address you sign in to ISN at, host only: `https://inspectionsupport.com`, or your white-label domain |
| `ISN_COMPANY_KEY` | ISN → Settings → My Access Keys |
| `ISN_ACCESS_KEY` | Same page |
| `ISN_SECRET_KEY` | Same page |
| `ISN_WEBHOOK_SECRET` | ISN → Settings → Webhooks, shown once when the webhook is created. Only for the order webhook |

Set the first four in Settings → Advanced → ISN. All five are **tenant-owned**: the
company's own value always beats a Worker env binding, because a platform key
winning would put every company's reports on one company's ISN account.

ISN access keys never expire and carry the full permissions of the ISN user who
owns them — issue them from a user whose permissions match what this needs.

There is no default domain. ISN is white-labelled, and a guessed host fails
looking exactly like a wrong key.

## How it is used

1. Put the ISN order number (the one ISN shows on the order) in the
   inspection's **Reference Number**. An inspection without one is not sent.
2. Publish a report. After the publish succeeds, the link is added to that ISN
   order as a public report — it appears in the order's Inspection Reports
   area with **Public** ticked, which is what puts it on the client's ISN
   report-delivery page. The link carries the primary client's portal token;
   republishing sends the same link again.
3. The row is read back from ISN before the sync counts as done. The outcome is
   returned as `isnSync` on the publish response.

ISN treats the newest report on an order as the one it emails and downloads,
so each publish adding a row is intended.

### This app's gates still apply

The link is this app's own report link, so this app's agreement, payment and
report-release gates apply to it exactly as they do to any other link it
issues. ISN's own delivery hold may apply as well, so a client can be asked to
sign or pay in both places. Letting ISN hold or release those gates is not part
of this integration.

## When it is not configured

Nothing happens on publish and `isnSync` is `null`. The same is true for an
inspection with no Reference Number.

## When it breaks

The publish is never undone: a report that did not reach ISN is still
published. `isnSync` comes back `{ ok: false, error }` with ISN's own message,
and the failure is logged. Our own missing data (no client email to issue a
link for) is named before any call to ISN.

Two ISN behaviours that are not in its published API document, both verified
against a live company and pinned in `tests/contract/isn/isn-api.live.spec.ts`:

- **Errors arrive as HTTP 200** with `{ "status": "error", "message": ... }`.
  Success is the body's `status`, never the status code.
- **`addreporturl` reads the query string.** The document says form-encoded
  body; a form body is answered "you must provide a url for the report".

Deleting a report row in ISN hides it (`show: false` in `/orderfiles`) rather
than removing it, so the read-back requires the row to be shown.

## Where the code lives

- `server/services/isn/api-base.ts` — credentials, the call, error shape
- `server/services/isn/report-link-payload.ts` — pure: the fields ISN reads
- `server/services/isn/report-link-sync.ts` — the push and the read-back
- `server/api/isn-webhook.ts`, `server/services/isn/webhook-signature.ts`, `server/services/isn/order-pull.ts`, `order-apply.ts`, `order-payload.ts` — the order webhook and applying an order to an inspection
- `app/components/settings/advanced/IsnPanel.tsx`, `app/lib/isn-settings.server.ts` — the settings panel
- `tests/contract/isn/` — the vendored schema excerpt, its contract spec, and the live spec

## Related

- [Integration adapters](../develop/integration-adapters.md)
- [QuickBooks Online](quickbooks.md)
