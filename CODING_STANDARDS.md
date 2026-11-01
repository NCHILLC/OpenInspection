# Coding standards

Rules a reviewer applies and no gate yet enforces. Rules a gate or lint rule enforces live in the gate, not here: `scripts/lib/gate-registry.mjs` lists the gates and `eslint.config.js` the lint rules, and a failing one prints its own fix. A rule here that gains a gate leaves this file in the same PR.

`[review]` = judgement a reviewer applies. `[no gate yet]` = mechanical, so a candidate for a new gate. `[partial: x]` = gate `x` covers part of it.

## JWT & auth

Mandatory for any code that touches authentication. The lint rule on `hono/jwt` imports and the cookie-options lint rule cover the two most common slips; the rest is below.

- **Keyring wiring** `[review]`: per-request keyrings are built in `contextBootstrap`, NOT `diMiddleware` (JWT auth needs the keyring before di runs), and exposed as `await c.var.keyringPromise`. `signJwt()` sets `kid` from `JWT_CURRENT_KID` and auto-injects `iat`; `verifyJwt()` rejects a missing or unknown `kid`. Without `iat`, KV session invalidation cannot work.
- **No HS256 fallback** `[review]`: no legacy HS256 path exists. `JWT_SECRET` is KDF input only, never a signing key. Do not list its consumers: every enumeration has gone stale.
- **Key rotation** `[review]`: provision `JWT_PRIVATE_KEY_V<N+1>` + `JWT_PUBLIC_KEY_V<N+1>` first (verify-only window), then flip `JWT_CURRENT_KID`. Old tokens stay verifiable until V<N> is retired.
- **Token NOT in the response body, one carved-out exception** `[no gate yet]`: login, setup and join MUST NOT return the JWT to a browser; delivery is `Set-Cookie` (HttpOnly). The exception is the in-process BFF, which identifies itself with `x-token-relay: 1` and receives `token` in the body (it writes its own session cookie). A browser never sends that header. Do not add a second exception without recording it here.
- **Cookie name** `[no gate yet]`: always `__Host-inspector_token` (enforces `Secure`, `Path=/`, no `Domain`).
- **deleteCookie** `[no gate yet]`: every call includes `{ path: '/', secure: true }`; omitting `secure` on a `__Host-` cookie throws at runtime. (`setCookie` is covered: lint requires a cookie-options factory from `server/lib/auth-helpers.ts`.)
- **No localStorage tokens** `[no gate yet]`: frontend code never stores a token in `localStorage` or `document.cookie`; same-origin `fetch()` sends the HttpOnly cookie.
- **KV invalidation** `[review]`: on password change/reset/delete write `pwchanged:{userId}` to KV; auth middleware rejects tokens with `iat < changedAt`.
- **D1 date safety** `[no gate yet]`: serialize DB date values through `safeISODate()` / `safeTimestamp()` from `server/lib/date.ts`; D1 returns Date, int and string.

## Input validation

- **Zod on every input** `[no gate yet]`: every endpoint that takes body, query or params validates with a Zod schema. No manual `if (!field)`, no `c.req.json<T>()` with only a generic (zero runtime protection).
- **OpenAPIHono routes**: `createRoute()` with `request.body/query/params` schemas, read via `c.req.valid('json' | 'query' | 'param')`. **Other routes**: `schema.safeParse(await c.req.json())`, 400 on failure.
- **Schema location** `[no gate yet]`: schemas live in `server/lib/validations/*.schema.ts`, never inline in a handler.
- Ids are opaque TEXT: `z.string().trim().min(1)`, not `.uuid()` (lint-enforced).

## Logging

- **`logger`, not console** `[partial: eslint no-console]`: server code imports `logger` from `server/lib/logger`. Lint bans `console.log` but allows `warn`/`error`/`info`, so those still need a reviewer. `server/lib/logger.ts` itself uses `console.info` on purpose. Browser-only script code may use `console.*`.
- **Signature** `[review]`: `logger.error(message, data?, error?)`: `data` is `Record<string, unknown>`, the optional `Error` is third.
- **No sensitive data** `[review]`: never log JWTs, passwords, API keys or full request bodies; log messages, status codes and non-sensitive ids.

## Tenant isolation

`[partial: tenantscope]` covers only an unscoped by-id `.where(eq(table.id, …))` on a tenant-scoped table.

- `tenantId` comes from the verified JWT (`c.get('tenantId')`), never from user input; a `CreateXSchema` never accepts it.
- Use `this.sdb` (`ScopedDB`), which injects the filter. With raw `db`, append `eq(table.tenantId, tenantId)` to every `where`.
- Every new table declares `tenantId: text('tenant_id').notNull()` `[no gate yet]`.
- Verify tenant ownership before returning any entity; responses must not carry another tenant's data.

## Schema

Policy from the 2026-06-04 DBA review. Applies to new tables and columns; legacy columns converge when a table is already being touched. Gated: timestamp columns (`lint:timestamps`), boolean `is_`/`has_` names (`lint:naming`), the 100-column ceiling.

- **Foreign keys** `[no gate yet]`: integrity is enforced in the application layer (ScopedDB + tenant filters). New tables do not declare `.references()` (a permanent migration liability on D1); existing FKs are frozen, not extended. Delete ordering in purge/cascade paths is the service layer's job.
- **Naming** `[no gate yet]`: money columns end `_cents` (integer cents, never floats); encrypted-at-rest columns end `_enc`; booleans are `integer(..., { mode: 'boolean' })`; index names start `idx_` (plain) or `uq_` (unique), and a fifth of existing ones are `uq_`, so a grep for `idx_` alone misses them. Names drizzle generated itself (`<table>_<column>_unique`) are legacy; add no more.
- **Money authority chain** `[review]`: an existing invoice is authoritative; otherwise the sum of `inspection_services` price snapshots; `inspections.price` is a denormalized cache, never reconciled the other way.
- **Status fields** `[no gate yet]`: a column modelling a state machine declares a drizzle `{ enum: [...] }` (type-layer only, no DDL cost).
- **Column retirement** `[no gate yet]`: native `ALTER TABLE … DROP COLUMN` is the way, even on FK-referenced tables. Drop migrations are hand-written and checked before applying: `grep -nE "PRAGMA|__new_|DROP TABLE|RENAME TO" <file>` must return nothing (those strings are the signature of a table rebuild, which needs `PRAGMA foreign_keys=OFF` outside a transaction and would lose referenced rows on D1). Keep the grep even though drizzle-kit currently emits the native drop. Freeze a column (stop all reads/writes, add a `-- DEAD (date, reason)` schema comment, never reuse the name) only when SQLite's native drop refuses it: a PRIMARY KEY, an inline UNIQUE or CHECK, a column named in a foreign key, a generated-column expression, a partial-index predicate, or a view. A column merely covered by an index is not one of these: drop the index first, in the same migration. A column still being read is drained first. Rationale and example: [`docs/reference/dev-workflow.md`](docs/reference/dev-workflow.md#rule-rationale-and-history).

## Comments

Annotate the durable artifact, not the transient migration. (`lint:migrefs` rejects migration sequence numbers; `0000_baseline.sql` is the only allowed reference.)

- **State the invariant, not the history** `[review]`: put *why a column or index exists* beside its definition in `server/lib/db/schema/`. "the `lot_size` column on `inspections`" beats "the `lot_size` column added in migration 0045". History lives in `git blame`.
- **Cite a stable id** `[review]`: PR#/issue# (`see #144`) or a feature name.
- **"Must stay in sync with X" is a latent bug** `[review]`: make the coupling executable, with a shared constant both sides import or a test asserting the equality.

## Cross-portal reuse

The client portal (token track: `/checkout`, `/agreements/sign`, `/invoice`, `/repair-builder`, Hub `?section=`) and the agent portal (account track, `/agent-*`) show many of the same entities: one product surface, two audiences. `[review]`, with a regression test in `app/components/agent/cross-portal-reuse.test.tsx` that renders one defect through both portals.

- **Same entity in both portals, same component.** Render the client component and express the difference as a prop; a parallel component drifts and only one gets the next fix.
- **A deliberate fork says why, in a comment at the fork**: the invariant that makes the two genuinely different, not the history. "Agent view is read-only" is a prop; "the agent's list spans inspections while the client's is one inspection" is a reason.
- **Capabilities come from one function, not a page.** Whether an actor may do something is decided where it is ENFORCED (server) and read by the UI, so a page never offers an action the API refuses.

## Tests

`lint:tests` and `lint:e2e-coverage` gate where a spec lives and that a config collects it. Not gated `[no gate yet]`: a fully-skipped spec needs a `TODO(...)` naming its blocker; name specs after behavior, not sprints.
