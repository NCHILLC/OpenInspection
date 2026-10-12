# AGENTS.md — OpenInspection (Open Source Edition)

**Session state: read `.ai/STATE.md` before anything else.** It is the one current-state file
for this project (what is in flight, what is next, what is blocked). Before ending a session,
overwrite it (40 lines max, claims checked against git and open PRs), append one line to
`.ai/LOG.md`, and park any open workstream in `.ai/handoffs/`, where the older handoffs and
QA plans also live. `.ai/` is untracked on purpose.

The open-source inspection engine: a single Cloudflare Worker (Hono entry mounting the API in-process, React Router v8 SSR for pages).

**Docs**: `docs/README.md` is the map (operate · develop · reference · concepts · integrations · compliance). Docs here cover the **engine**: deploying it, operating it, changing it, integrating it. Using the product day to day is documented at <https://inspectorhub.io/docs>, which serves self-hosted and hosted deployments alike.

**This checkout is a fork.** `origin` is `NCHILLC/OpenInspection` (**public**, and not a GitHub-network fork — see the fork log), `upstream` is `InspectorHub/OpenInspection`. What has been taken from upstream, skipped, or deliberately diverged on is recorded in [`docs/develop/fork-log.md`](docs/develop/fork-log.md) — read it before merging upstream or before "fixing" behaviour that looks like drift. It is linked from here rather than from `docs/README.md` on purpose: that map is upstream's, and a fork-only row in it would conflict on every merge.

## Check upstream BEFORE debugging anything

**Before investigating any error, bug, failing test or red gate: look for the
fix upstream first.** Not optional, and not
a judgement call about how obvious the symptom looks.

```bash
git fetch upstream
git log main..upstream/main --oneline --no-merges -i --grep='<symptom keyword>'
git log main..upstream/main --oneline --no-merges -- <file you suspect>
```

A hit: cherry-pick or port it, and record the decision in
[`docs/develop/fork-log.md`](docs/develop/fork-log.md). A miss is worth knowing
too — it means the bug is this fork's own, and once fixed it belongs in the fork
log as a deviation. 

**Reading CI requires the `gh` CLI, not the GitHub MCP connector.** The
connector's token has no Checks permission: `pull_request_read` does expose a
`get_check_runs` method, but it and `get_status` both return
`403 Resource not accessible by integration` (verified 2026-09-07). Confirm `gh`
before reporting that CI results are unavailable — do not repeat the limitation
from memory without checking:

```bash
gh auth status                                    # expect: Logged in to github.com account NCHILLC
gh pr checks <n> --repo NCHILLC/OpenInspection
gh run view --job <id> --log-failed
```

`gh` may be missing from an
existing shell's PATH if that shell started before the install — call it as
`"/c/Program Files/GitHub CLI/gh.exe"` rather than concluding it is absent. A
timed-out job archives no log, so `--log-failed` returns EMPTY for one; use
`gh run view --job <id>` and read the annotation instead.

## Commands

```bash
# Single package.json at the root. Commentary on each command: docs/reference/dev-workflow.md
npm install
npm run dev          # build + wrangler dev: real workerd, no HMR; verifies built behavior
npm run dev:hmr      # Vite HMR, the fast loop; workers/app.ts must keep its top-level import graph tiny
npm run dev:tunnel   # dev + Cloudflare Quick Tunnel (needed for collab WebSockets); PUBLIC while running — stop it when finished
npm run build        # react-router build: server/ + app/ into one worker
npm run deploy       # standalone: build + wrangler deploy (real ids via wrangler.local.jsonc)
npm run deploy:saas  # saas: build + wrangler deploy with wrangler.saas.jsonc
npm run type-check   # i18n:compile + typegen, then four tsc passes serially (app, api, e2e, tests)
npm run type-check:app   # tsc -b tsconfig.json
npm run type-check:api   # tsc -b tsconfig.api.json; fastest loop for server/ work
                         # `.types/` is generated and gitignored: never commit it
npm run lint
npm run test:unit | test:web | test:workers | test:contract | test:e2e   # config per suite: testing-layout.md
npm run test:contract:live   # real third-party API; needs a connected Intuit sandbox

# Database — drizzle-kit schema-first (server/lib/db/schema is the source of truth)
npm run db:migrate          # apply migrations to local D1
npm run db:migrate:remote   # apply migrations to remote D1
npm run db:generate         # generate a forward migration from schema changes
npm run db:check            # drift gate: schema vs migrations/ must match
```

## Key Files & Directories

The layout is conventional and discoverable: `server/`, `app/`, `packages/`, `migrations/`, `public/`. `workers/app.ts` is the single worker entry; see Architecture below for what it does and why.

### Test Layout

Directory = suite; a spec's location alone decides which config runs it (gated by `npm run lint:tests`). The location → suite → config table is in [`docs/reference/testing-layout.md`](docs/reference/testing-layout.md).

Where a spec goes is gated by `npm run lint:tests`; decision list and rules: `docs/develop/testing.md` §1. Component/hook tests co-locate under `app/` (never in `tests/`); unit specs live in `tests/unit/<domain>/` (named for the `server/api/` module or service family, spec files only, never flat at the root). Do not recreate `tests/web/unit/`, `tests/web/e2e/` or `tests/integration/`. Every spec is collected by exactly one config; fully-skipped specs need a `TODO(...)` naming their blocker; name specs after behavior, not sprints.

## Architecture

How the single worker, auth, tenancy modes, inspection engine, frontend and the `wrangler*.jsonc` config files (which one wins, what each tracks) fit together: [`docs/reference/architecture-notes.md`](docs/reference/architecture-notes.md). Two standing rules from it:

- `useOfflineQueue` was RETIRED with the rest of the bespoke offline layer in #181; do not reach for it.
- `packages/shared-ui/src/index.ts` is the authoritative component list. Do not maintain a count or list of components in docs — read the file.

## Environment Variables

Table of every variable and binding: [`docs/reference/environment-variables.md`](docs/reference/environment-variables.md). Read it before adding, renaming or changing the default of one.

## JWT & Auth Security Rules

**Mandatory** for any code that touches authentication. Violations reintroduce critical vulnerabilities.

- **ES256 keyring**: All JWT signing and verification MUST go through `server/lib/jwt-keyring.ts`. Direct `sign()` / `verify()` calls from `hono/jwt` are FORBIDDEN — the keyring pins the algorithm to ES256 (ECDSA P-256 SHA-256), stamps the `kid` header, and enforces multi-version verification. Per-request keyrings are pre-built in `contextBootstrap` (NOT `diMiddleware` — JWT auth needs the keyring before di runs) and exposed as `await c.var.keyringPromise`.
- **kid required**: Every JWT MUST carry a `kid` header. `signJwt()` sets it from `JWT_CURRENT_KID`; `verifyJwt()` rejects tokens with no kid, or with a kid not in the keyring.
- **iat claim**: `signJwt()` auto-injects `iat: Math.floor(Date.now() / 1000)` when the caller omits it. Without `iat`, KV session invalidation (`pwchanged:{userId}`) cannot work.
- **No HS256 fallback**: There is NO legacy HS256 path. Pre-launch architectural choice — see rotation scripts and docs. The remaining `JWT_SECRET` env binding is KDF input only, never a JWT signing key. Do not list its consumers: dozens of files read it and every enumeration has gone stale.
- **Key rotation flow**: To rotate, provision `JWT_PRIVATE_KEY_V<N+1>` + `JWT_PUBLIC_KEY_V<N+1>` first (verify-only window), then flip `JWT_CURRENT_KID` to the new version. Old tokens remain verifiable until V<N> is retired.
- **Token NOT in response body — one carved-out exception.** Login, setup and join MUST NOT return the JWT to a browser; delivery is `Set-Cookie` (HttpOnly). The exception is the in-process BFF, which identifies itself with `x-token-relay: 1` and then receives `token` in the body,  (it has to write its own session cookie). A browser never sends that header. Do not add a second exception without one here.
- **Cookie name**: Always use `__Host-inspector_token` (enforces `Secure`, `Path=/`, no `Domain`).
- **setCookie attributes**: Every `setCookie()` MUST include `httpOnly: true, secure: true, sameSite: 'Strict', path: '/'`.
- **deleteCookie secure**: Every `deleteCookie()` MUST include `{ path: '/', secure: true }`. Omitting `secure` on `__Host-` cookies throws a runtime exception.
- **No localStorage tokens**: Frontend JS MUST NOT store tokens in `localStorage` or `document.cookie`. Same-origin `fetch()` sends the HttpOnly cookie automatically.
- **KV invalidation**: On password change/reset/delete, write `pwchanged:{userId}` to KV. Auth middleware rejects tokens with `iat < changedAt`.
- **D1 date safety**: Always use `safeISODate()` / `safeTimestamp()` from `server/lib/date.ts` when serializing DB date values. D1 returns mixed formats (Date, int, string).

## Input Validation Rules

- **Zod required**: Every API endpoint that accepts user input (body, query, params) MUST validate using a Zod schema. No manual `if (!field)` or TypeScript generics-only validation.
- **OpenAPIHono routes**: Use `createRoute()` with `request.body/query/params` schemas and access validated data via `c.req.valid('json')`, `c.req.valid('query')`, `c.req.valid('param')`.
- **Non-OpenAPIHono routes**: Use `schema.safeParse(await c.req.json())` and return 400 on failure. Applies to workaround routes that cannot use `createRoute()`.
- **Schema location**: All Zod schemas live in `server/lib/validations/*.schema.ts`. Do not define schemas inline in route handlers.
- **No raw c.req.json()**: Never use `c.req.json<T>()` with only TypeScript generics — generics provide zero runtime protection.

## Language Rules

- **English only**: All source code, comments, documentation, commit messages, and user-facing strings MUST be written in English. No Chinese or other non-English text is permitted.

## Structured Logging Rules

- **No raw console**: Server-side code MUST use `import { logger } from '../lib/logger'` instead of `console.log/error/warn/info`. The `Logger` class outputs structured JSON for log aggregators.
- **Exception**: Client-side JS inside `<script>` tags or inline template scripts (runs in browser) MAY use `console.*`.
- **Exception**: `server/lib/logger.ts` itself uses `console.info` internally — that is correct and must not be changed.
- **Error signature**: `logger.error(message, data?, error?)` — second arg is `Record<string, unknown>`, third is optional `Error`. Do NOT pass raw Error as second arg.
- **No sensitive data in logs**: Never log JWT tokens, passwords, API keys, or full request bodies. Log only error messages, status codes, and non-sensitive identifiers.

## Multi-tenant Security Rules

- **Mandatory tenantId**: Every new database table MUST include `tenantId: text('tenant_id').notNull()` to ensure physical isolation.
- **Fail-Closed Access**: Use `this.sdb` (`ScopedDB`) for all database operations to automatically inject tenant filters.
- **Query Hardening**: If using raw `db`, you MUST explicitly append `eq(table.tenantId, tenantId)` to every `where` clause.
- **Schema Validation**: All input schemas (`CreateXSchema`) must ensure `tenantId` is handled via context, never accepted directly from end-user input.

## Tenant Isolation Rules

- **JWT tenant scoping**: Every authenticated API handler MUST read `tenantId` from JWT claims (`c.get('tenantId')`), never from user input.
- **DB queries**: All database queries MUST filter by `tenantId`. Use service-layer methods that enforce this automatically.
- **Cross-tenant prevention**: Never trust client-supplied `tenantId`. The middleware sets it from the verified JWT — use that value exclusively.
- **Data responses**: API responses MUST NOT leak data from other tenants. Verify tenant ownership before returning any entity.

## Schema Rules

DB design policies (2026-06-04 DBA review). These apply to ALL new tables/columns; legacy columns converge opportunistically when a table is already being touched — no big-bang migrations.

- **Timestamps**: new columns MUST be `integer(..., { mode: 'timestamp_ms' })` (epoch milliseconds). Calendar-semantic fields with no time component (e.g. `due_date`) MAY be `YYYY-MM-DD` TEXT but must say so in a comment. Never introduce new raw `integer` or text-datetime timestamp columns.
- **Foreign keys**: referential integrity is enforced at the APPLICATION layer (ScopedDB + tenant filters), not the database. New tables MUST NOT declare `.references()`  (a permanent migration liability on D1). Existing FKs are frozen as legacy; do not extend them. Delete-ordering in purge/cascade paths is the service layer's responsibility.
- **Naming**: money columns end in `_cents` (integer cents, never floats); encrypted-at-rest columns end in `_enc`; booleans always use `integer(..., { mode: 'boolean' })` (never raw 0/1); index names are prefixed by intent — `idx_` for a plain index, `uq_` for a unique one. Roughly a fifth carry the `uq_` form, so a grep for `idx_` alone will miss them; names drizzle generated itself (`<table>_<column>_unique`) are legacy, do not add more.
- **Money authority chain**: when an invoice exists it is authoritative; otherwise the sum of `inspection_services` price snapshots; `inspections.price` is a denormalized cache only — never reconcile the other way.
- **Status fields**: any column that models a state machine MUST declare a drizzle `{ enum: [...] }` (type-layer only, no DDL cost).
- **Column retirement**: native `ALTER TABLE … DROP COLUMN` is the expected way to retire a column, and it works even on FK-referenced tables. Drop migrations are hand-written and verified before they are applied: `grep -nE "PRAGMA|__new_|DROP TABLE|RENAME TO" <file>` must return nothing — those strings are the signature of a table rebuild, which needs `PRAGMA foreign_keys=OFF` outside a transaction and would lose referenced rows on D1. Keep the grep even though drizzle-kit currently emits the native drop. Freezing (stop all reads/writes, add a `-- DEAD (date, reason)` schema comment, never reuse the name) is the exception, reserved for columns SQLite's native `DROP COLUMN` genuinely refuses: a PRIMARY KEY, an inline UNIQUE or CHECK, one named in a foreign key, a generated-column expression, a partial-index predicate, or a view. A column merely covered by an index is NOT one of these: drop the index first, in the same migration. A column still being read needs draining first, whatever the reason it can't simply go. Full original wording, drizzle-kit evidence and an example: [`docs/reference/dev-workflow.md`](docs/reference/dev-workflow.md#rule-rationale-and-history).

## Quality gates

CI is a strict superset of pre-commit, not the same set (what each runs: [`docs/reference/dev-workflow.md`](docs/reference/dev-workflow.md#quality-gates-mechanism)). `verify` is the authoritative gate (wire it up as a required status check). The pre-commit hook is a fast local guard — bypass only with `--no-verify` (discouraged). 

**Run the gates BEFORE writing, not at commit.** `npm run lint:gates` is the
20-gate pre-commit rung and takes seconds. Paying it up front tells you straight
away that (say) a file is at its size cap — where finding out at commit time
means discovering it after a multi-minute eslint pass, an hour into work that
now has to be restructured. 

**Run `npm run preflight` before trusting anything a dev server says.** It
checks for worktrees shadowing the checkout, a build that is not HEAD, and a
port that looks alive but is not. Add `--url http://localhost:5173` to compare
the SERVED commit against HEAD. 

**Worktrees belong OUTSIDE this checkout** (`../oi-worktrees/`, not
`.Codex/worktrees/`). A worktree inside the repo makes the preview launcher serve ITS build on the expected port, so every observation is about other source; an absolute path in `launch.json` does not help.

**`--no-verify` is blocked**, with `--dangerously-skip-permissions` and
`HUSKY=0`, by a PreToolUse hook (`~/.Codex/hooks/block-verify-skip.mjs`).
CI does run now — `verify` fires on pull requests and on pushes to `main`
(2026-09-07) — but it **does not block a merge today**. The only ruleset, `verify`, targets `refs/heads/verify` rather than `main` and requires no status check (evidence: [`docs/reference/dev-workflow.md`](docs/reference/dev-workflow.md#rule-rationale-and-history)). So a red `verify` is a
signal you have to choose to honour, and **pre-commit remains the only gate that
actually stops anything** until that ruleset targets `main` with a required check.
If a gate fails, fix the cause.

Hook mechanism, what pre-commit and CI each run, and the CI job list: [`docs/reference/dev-workflow.md`](docs/reference/dev-workflow.md#quality-gates-mechanism).

## Comment Rules

Annotate the durable artifact, not the transient migration: migration sequence numbers renumber on squash.

- **No migration sequence numbers in code comments** (`migration 0045`, `0052_inspector_slug.sql`, `pre-migration 0040`, …). The only allowed reference is `0000_baseline.sql` — it never renumbers. Enforced by `npm run lint:migrefs` (`scripts/check-migration-refs.mjs`); also runs in `npm run lint` and pre-commit.
- **State the invariant, not the history.** Put *why a column/index exists* next to its definition in `server/lib/db/schema/` (it travels with the field and survives any renumber). "the `lot_size` column on `inspections`" beats "the `lot_size` column added in migration 0045". History lives in `git blame`.
- **For traceability, cite a stable id** — PR# / issue# (`see #144`) or a feature name — never a migration number. 
- **"Must stay in sync with X" coupling → make it executable, not prose.** A comment that says "must match the inline DDL / the backfill list" is a latent bug; people forget. Prefer a shared constant both sides import, or a test that asserts the equality. 

## Cross-Portal Reuse

The client portal (token track: `/checkout`, `/agreements/sign`, `/invoice`,
`/repair-builder`, Hub `?section=`) and the agent portal (account track,
`/agent-*`) show many of the same entities. They are ONE product surface with
two audiences, not two products.

- **Same entity in both portals ⇒ same component.** Render the client component
  and express the difference as a prop. A parallel component drifts, and only
  one of the two gets the next fix .
- **A deliberate fork must say why, in a code comment at the fork.** State the
  invariant that makes the two genuinely different (not the history of how it
  happened). "Agent view is read-only" is a prop; "the agent's list spans
  inspections while the client's is one inspection" is a reason.
- **Capabilities come from one function, not from a page.** Whether an actor may
  do something is decided where it is ENFORCED (server) and read by the UI, so
  a page can never offer an action the API refuses.
- Guarded by `app/components/agent/cross-portal-reuse.test.tsx`, which renders
  one defect through both portals and compares what a reader sees.

## Product Terminology (canonical)

User-facing copy and NEW code identifiers use these terms. (Existing surfaces are renamed in a dedicated terminology pass — don't mix renames into feature work.)

| Use | Not |
|---|---|
| **Inspection** | Order, Job |
| **Company** (name/branding settings) | Workspace (user-facing) |
| **Repair Items** | Recommendations (user-facing) |
| **Canned Comment** (library entry) | "Comment" unqualified — distinguish from per-inspection **Notes** (inspector free text) |
| **Client** / **Agent** (contact types) | Customer |
