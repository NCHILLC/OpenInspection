# Dev workflow notes

Command commentary, quality-gate mechanism, and the history behind rules in `CLAUDE.md` / `AGENTS.md`, moved verbatim so that those files hold only rules, commands and pointers.

## Command notes

The commands block as it was, with all commentary:

```bash
# Single package.json at the root.
npm install
npm run dev          # Build + run the worker locally (react-router build + wrangler dev).
                     # Production-shape (real workerd, no HMR) — use to verify built behavior.
npm run dev:hmr      # Vite dev server with HMR (react-router dev). The fast iteration loop.
                     # Works since the lazy-API entry refactor (workers/app.ts) — the entry
                     # must keep its top-level import graph tiny; see the comment there.
npm run dev:tunnel   # Like `dev`, but also exposed over a Cloudflare Quick Tunnel (https).
                     # REQUIRED to exercise the collab/presence WebSockets: the session
                     # cookie is `Secure`, and a page served over http://localhost opens
                     # `ws://` — which browsers do not treat as a secure scheme, so the
                     # cookie is withheld and the handshake 401s. Over the tunnel the same
                     # endpoints upgrade (wss://) and both presence and Y.Doc sync work.
                     # The tunnel URL is a new origin: log in again there. It is PUBLIC
                     # while running — stop it when finished. (A self-signed
                     # `--local-protocol https` is not a substitute: Chrome refuses it.)
npm run build        # react-router build — bundles server/ (API) + app/ (RR SSR) into one worker
npm run deploy       # standalone: build + wrangler deploy (real ids via wrangler.local.jsonc)
npm run deploy:saas  # saas: build + wrangler deploy with wrangler.saas.jsonc
npm run type-check   # i18n:compile + react-router typegen, then FOUR tsc passes serially
                     # (app, api, e2e, tests) — serial to keep peak RAM down
npm run type-check:app   # `tsc -b tsconfig.json` — the app/worker program
npm run type-check:api   # `tsc -b tsconfig.api.json` — the server program; fastest loop for server/ work

# Both are BUILD-mode (`tsc -b`), because the two programs are TypeScript project
# references: tsconfig.api.json is composite and emits .d.ts into `.types/`, and the
# app program consumes those instead of recompiling ~800 server sources (that is what
# made a cold app pass exceed an 8 GB heap). Consequences:
#   - `type-check:app` first brings the api project up to date. Nothing changed under
#     server/ ⇒ a stat pass; something did ⇒ a real rebuild the app pass depends on.
#   - `.types/` is generated and gitignored. Never commit it — a stale .d.ts produces
#     boundary errors with no matching source. Deleting the directory is always safe;
#     its build-info lives inside it, so a missing output dir is just a cold project.
npm run lint
npm run test:unit    # API unit tests (vitest --config vitest.api.config.ts)
npm run test:web     # Web unit tests (vitest --config vitest.config.ts)
npm run test:workers # Real-runtime (workerd) queue-path tests (vitest.workers.config.ts)
npm run test:contract # Our outbound payloads vs a third party's own schema — offline, no credentials
npm run test:contract:live # The same payloads against the REAL API — needs a connected Intuit sandbox
npm run test:e2e     # Playwright E2E
```

## Quality gates: mechanism

**Opening paragraph, as it was** (the middle is unchanged in the rule file):

> CI is a strict superset of pre-commit, not the same set: the hook runs the `precommit` rung of the gate registry and a tiered tsc, while CI runs every gate at both rungs plus the type-aware eslint pass, the full type-check and every suite. ... Mechanism, steps, and Node version are aligned across the superproject and the portal/cms submodules.

- **Hook mechanism**: `.githooks/pre-commit`, activated by the `prepare` npm script (`git config core.hooksPath .githooks`) on `npm install`/`npm ci` — native git hooks, **no husky**.
- **Pre-commit** (`.githooks/pre-commit`): tiered type-check (scoped to staged files — skip / api-only / full) → `lint-staged` (eslint --fix, `ESLINT_FAST=1`) → every gate declared at the `precommit` rung in `scripts/lib/gate-registry.mjs`, run in ONE node process by `scripts/run-gates.mjs`. That is two dozen gates, not the three this line used to name; the registry is the list and must not be copied here. Commits with no staged `.ts`/`.tsx` skip the type-check entirely. The Worker bundle-size gate is NOT here — it lives in `.githooks/pre-push`.
- **CI** (`.github/workflows/ci.yml`, Node 22): nine parallel jobs — `typecheck-app`, `lint-eslint`, `lint-gates` (+ `db:check`), `test-unit` (4 shards), `test-contract`, `test-workers`, `test-web` (4 shards), `build` (+ bundle size), and `e2e` (a 2-way matrix). `verify` does no work of its own: it is the aggregate job branch protection keys off, and it waits on all nine including `e2e`. CodeQL runs separately (`codeql.yml`). Details: `docs/develop/testing.md`.

## Rule rationale and history

Text removed from rule sections. The rule itself stays in `CLAUDE.md` / `AGENTS.md`; this is why it exists.

### Schema: column retirement (full original bullet)

- **Column retirement**: native `ALTER TABLE … DROP COLUMN` is the expected way to retire a column, and it works even on FK-referenced tables. Drop migrations are hand-written, and verified before they are applied: `grep -nE "PRAGMA|__new_|DROP TABLE|RENAME TO" <file>` must return nothing — those four strings are the signature of a table rebuild (copy the table under a new name, retire the original, rename the copy), which needs `PRAGMA foreign_keys=OFF` outside a transaction and would lose referenced rows on D1. This rule used to say `db:generate` EMITS such a rebuild for a drop; on drizzle-kit 0.31.10 it does not — verified on a plain column, on a column carrying a unique index, and on an FK-referenced table, each time producing the native `DROP INDEX` + `ALTER TABLE … DROP COLUMN`. Hand-write them anyway, because the migration is where the reasoning lives and a generated one-liner carries none; keep the grep because a future version could change its mind. Freezing (stop all reads/writes, add a `-- DEAD (date, reason)` schema comment, never reuse the name) is the exception, reserved for the cases SQLite's native `DROP COLUMN` genuinely refuses: a PRIMARY KEY column, a column carrying an inline UNIQUE or CHECK constraint in the table DDL, one named in a foreign key, a generated-column expression or a partial-index predicate, or one referenced by a view. A column merely covered by an index — UNIQUE or not — is NOT one of these: drop the index first, in the same migration, and the column goes. `agreement_requests.token` carried a unique index and went that way. A column still being read needs draining first, whatever the reason it can't simply go.

### Quality gates

- Anecdote removed from the "Run the gates BEFORE writing" paragraph: Not hypothetical: that is how a duplicate of an existing module got written on 2026-09-06. The size cap that would have forced the split — and so surfaced the module already there — was not consulted until the commit failed.
- Ruleset detail removed from the `--no-verify` paragraph: The repository is public, so GitHub Free does enforce rulesets on it; the one that exists does not guard `main`. The `verify` ruleset is `active` but targets `refs/heads/verify` (a branch of that name), and carries only deletion and non-fast-forward rules — no required status check (verified 2026-09-13 via `gh api repos/NCHILLC/OpenInspection/rulesets/22446814`).
- Worktree rationale, as it was: A worktree inside the repo makes the preview launcher resolve the project root to it and serve ITS build on the expected port — `/status` reports the wrong commit and every observation is about other source. An absolute path in `launch.json` does not save you; the launcher rebases it.

### Comment rules

- Intro paragraph, as it was: Migration sequence numbers are an unstable, positional ordering token — squash/consolidation renumbers them, leaving comments dangling at files that no longer exist (the `0000_baseline.sql` consolidation made every `migration 00NN` comment point to nothing). Annotate the durable artifact, not the transient migration.
- Example: `tests/unit/platform/inline-ddl-schema-sync.spec.ts` asserts the workers specs' hand-maintained `tenant_configs` DDL covers every Drizzle schema column — replacing the old "remember to sync this DDL" comment that blocked #164.

### Cross-portal reuse

- Removed from the first bullet: — that is how the agent repair-items page ended up dropping photos and the item label that were already in its payload.

### Check upstream, preflight, token relay

- Removed from the "Check upstream" opening: This fork tracks a fast-moving upstream (232 commits merged on 2026-09-07 alone), so the odds that a failure has already been diagnosed and fixed there are high, and re-deriving a fix costs far more than the lookup does. 
- Removed from its closing paragraph: Either way the lookup takes seconds and its answer changes what you do next.
- Removed from the `npm run preflight` paragraph: Every check in it is a trap that has already cost a session; the script header says which.
- Removed from the token-in-body exception (what it replaced): because Workers `fetch()` may strip `Set-Cookie` on a server-to-server hop and the BFF has to write its own session cookie.
- Removed from the HS256 bullet (as it was): State it that way rather than listing its consumers: there are dozens of files reading it (secret crypto, signed-URL and session HMACs, token derivation), and every enumeration written here has gone stale.
- Removed from the foreign-keys bullet (as it was): — D1 cannot rebuild a table referenced by an FK (no `PRAGMA foreign_keys=OFF` outside a transaction), so every FK is a permanent migration liability.
- Removed from the intro paragraph (as it was): The open-source inspection engine. A single Cloudflare Worker (the cloudflare/react-router-hono-fullstack-template shape): a Hono entry that mounts the full API in-process and delegates page routes to React Router v8 SSR.
- Removed from the gh paragraph: Installed via `winget install --id GitHub.cli`. 
- Removed from the traceability bullet: These never renumber and link to full context.

### Docs map line

Directory listing dropped from the `**Docs**` line (it duplicates [`docs/README.md`](../README.md)): `docs/operate/` (deploy, upgrade, JWT-keyring rotation, SMS compliance) · `docs/develop/` (architecture, testing, design system) · `docs/reference/` (API, database, roles, deployment modes) · `docs/concepts/` (how the engine works) · `docs/integrations/` (external services) · `docs/compliance/` (data handling).
