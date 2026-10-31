# Field log

A per-user running log of what happened on an inspector's phone during an
inspection, so a problem can be diagnosed after the visit without the inspector
having to describe it.

## Turning it on

Off for everyone by default. Each user turns it on for themselves under
**Settings → Profile → Record my activity during inspections**. Migration
`field_log_events` must be applied first.

## What is recorded

Screen opens, rating, photo add, template pick, publish, failed requests (method,
status, path), crashes and error screens (error type only), and online/offline
changes. Each row has time, tenant, user and inspection id.

Never recorded: passwords, tokens, query strings, client details, inspection note
text, or error messages. The only free text is a note typed into **Mark issue**
(500 characters; the phone keyboard's dictation works there). The API schema
rejects prose in every other field.

Events wait in the phone's `localStorage` (newest 1000) and upload when connected.
They are deleted after 30 days by the `field_log_events` retention rule.

## Reading it

- **People:** `/inspections/<id>/field-log`, also linked from the Mark issue panel.
- **Claude:** call `GET /api/field-log/inspections/<id>` through the app's MCP
  connection (operation `getFieldLogTimeline`, read scope). The tool appears only
  when the deployment sets `MCP_ENABLED` and `MCP_EXTENDED_TOOLS`. It returns `events`
  plus `issues`, each with `precedingEventIds` covering the five minutes before
  the marker. No database access is needed. Without an MCP connection, have the
  inspector paste the timeline page.
