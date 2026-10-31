# ISN — report links on ISN orders

For companies that book and bill through ISN (Inspection Support Network) and
write reports here. When a report is published, its link is added to the ISN
order it belongs to, so the client and agent find it where ISN already sends
them.

This is the report half of
[InspectorHub/OpenInspection#321](https://github.com/InspectorHub/OpenInspection/issues/321).
Importing ISN's scheduled orders is in progress: the webhook receiver below
turns each changed order into an OI inspection, and an hourly catch-up sweep
picks up what the webhook missed.

## Order webhook

`POST /webhooks/isn` takes ISN's order webhooks. It checks `X-ISN-Signature`
against `ISN_WEBHOOK_SECRET`, then re-reads the order with `GET /order/{id}` and
stores ISN's answer in `isn_orders`. The webhook body is trusted only for which
order changed. A delivery with `"test": true` is acknowledged and not applied.

- A body over 256 KB: 413, refused before any lookup. There is no rate limit, so a retry is never turned away.
- No secret, no tenant, or a bad signature: 401. Nothing is read or written.
- The re-fetch fails: 500, so ISN retries (8 attempts over about a day).
- A repeated delivery re-reads the order again; the row holds ISN's latest state.

**Catch-up sweep.** Once an hour the cron job `isn-order-reconcile` lists ISN's
orders dated from yesterday on (`GET /orders?datetimeafter=`) and pulls each one
that OI does not have, whose `modified` differs from the stored copy, or that
never became an inspection. Its first run is the backfill of today-forward orders.
It runs only when `ISN_WEBHOOK_SECRET` and the four ISN keys are set: the keys
alone also serve the report link and must not start importing orders. It pulls
at most 5 orders per invocation and continues on the queue. It also frees a
creation claim left by a Worker that died mid-create (older than 15 minutes).
Orders that fail to pull are counted as `failed` in the batch result and tried
again on the next pass.

**Settings → Advanced → ISN.** The panel shows whether intake is on (the webhook
secret is set; the value itself is never shown), has a **Test connection**
button, and **Pull ISN orders now** shows the API's own message when it is
refused. Test connection (`POST /api/integrations/isn/test`, owner or manager)
makes one read-only call, the order list for today, with the stored keys. On a
failure it shows ISN's own message, because ISN answers HTTP 200 to errors and
the message is the only signal. Results are kept in the same "last tested"
history as the other integrations.

Not covered: an order dated before yesterday, and an order ISN stops listing
(not checked whether `GET /orders` lists cancelled or deleted orders).

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

On the inspection page, and in the editor's settings sheet, the **From ISN**
card shows what the stored order says that OI keeps nowhere else: ISN's order
number, access code, occupied, utilities on, cross streets, paid and agreement
signed in ISN, report number, policy holder and number, "Cancelled in ISN", and
a Directions link (ISN's `mapurl` when it is https, else a maps search on the
coordinates or address). It is read-only: change these in ISN. Empty fields are
not shown. Staff only (`GET /api/inspections/{id}/isn`); the access code never
reaches the inspection row or the public report. Not shown yet: ISN's
id-valued fields (escrow officer, insurance agent, refer reason, cost center,
order type), order notes and attachments. **Open in ISN** links to the order's
page in ISN (`/<company key>/order/view?pq=`, where `pq` is base64 of the
zlib-compressed, PHP-serialized order number); it shows once the ISN keys are set.

On the inspections list, **From ISN** (in the filter strip, shown once any
inspection came from ISN) lists those inspections. A row whose order has a
service missing from the inspection, or an inspector with no OI user, carries a
warning chip with the counts; hovering it names the services. It is a warning
only: nothing is blocked. To clear a service warning, add the service to the
inspection by hand (renaming the OI service does not add it to inspections that
already exist). An inspector warning clears on the next ISN delivery once that
person's email is an OI user.

To turn it on: create the webhook in ISN (Settings → Webhooks → Add Webhook,
POST, URL `https://<this app's host>/webhooks/isn`) for the order events. If ISN
offers "Add signing secret", tick it and set the secret it shows as
`ISN_WEBHOOK_SECRET`. Older ISN offices have no signing option on that screen and
no REST `/webhooks` (it answers "missing or invalid action specified"; seen
2026-10-26): there, set `ISN_WEBHOOK_SECRET` to a long random string and use
`https://<this app's host>/webhooks/isn?key=<that string>` as each webhook's URL.
The key is checked only on a delivery with no `X-ISN-Signature`; it is safe
enough because the body only names an order, which OI then re-fetches with its
own ISN keys. Then use ISN's "Send test event" if your ISN has it. The bare path
uses standalone's fixed tenant; SaaS has no per-tenant ISN webhook path.

## What you need

| Key | Where |
|---|---|
| `ISN_DOMAIN` | The address you sign in to ISN at, host only: `https://inspectionsupport.com`, or your white-label domain |
| `ISN_COMPANY_KEY` | ISN → Settings → My Access Keys |
| `ISN_ACCESS_KEY` | Same page |
| `ISN_SECRET_KEY` | Same page |
| `ISN_WEBHOOK_SECRET` | ISN's signing secret, or (older ISN, unsigned webhooks) a random string you also put in the webhook URL as `?key=`. Only for the order webhook |

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
