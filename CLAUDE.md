# CLAUDE.md — OpenInspection (Open Source Edition)

A single Cloudflare Worker: Hono entry mounting the API in-process, React Router v8 SSR for pages. `docs/README.md` is the map of the engine docs (operate · develop · reference · concepts · integrations · compliance); using the product day to day is documented at <https://inspectorhub.io/docs>.

**This checkout is a fork.** `origin` is `NCHILLC/OpenInspection` (**public**, not a GitHub-network fork), `upstream` is `InspectorHub/OpenInspection`. Before merging upstream or "fixing" behaviour that looks like drift: [`docs/develop/fork-log.md`](docs/develop/fork-log.md) (what was taken, skipped, diverged on). It is linked from here, not from `docs/README.md`, because that map is upstream's and a fork-only row would conflict on every merge.

## Check upstream BEFORE debugging anything

Before investigating any error, bug, failing test or red gate, look for the fix upstream:

```bash
git fetch upstream
git log main..upstream/main --oneline --no-merges -i --grep='<symptom keyword>'
git log main..upstream/main --oneline --no-merges -- <file you suspect>
```

A hit: cherry-pick or port it and record the decision in the fork log. A miss means the bug is this fork's own; once fixed it goes in the fork log as a deviation.

## Reading CI

Use the `gh` CLI. The GitHub MCP connector's token has no Checks permission: `get_check_runs` and `get_status` return `403 Resource not accessible by integration` (verified 2026-09-07).

```bash
gh auth status                                    # expect: Logged in to github.com account NCHILLC
gh pr checks <n> --repo NCHILLC/OpenInspection
gh run view --job <id> --log-failed
```

An existing shell may lack `gh` on PATH; call `"/c/Program Files/GitHub CLI/gh.exe"`. A timed-out job archives no log, so `--log-failed` is EMPTY for it: `gh run view --job <id>` shows the annotation.

## Working here

- **Gates first.** `npm run lint:gates` takes seconds; run it BEFORE writing so a file at its size cap surfaces before a multi-minute eslint pass. CI is a strict superset of pre-commit; `verify` is the required status check ([`docs/reference/dev-workflow.md`](docs/reference/dev-workflow.md#quality-gates-mechanism)).
- **`npm run preflight`** before trusting a dev server. It catches worktrees shadowing the checkout, a build that is not HEAD, and a port that looks alive but is not; `--url http://localhost:5173` compares the SERVED commit with HEAD.
- **Worktrees live OUTSIDE this checkout** (`../oi-worktrees/`, not `.claude/worktrees/`): the preview launcher serves an inside worktree's build on the expected port, and an absolute path in `launch.json` does not help.
- **A failing gate gets a fix at its cause.** A PreToolUse hook blocks `--no-verify`, `--dangerously-skip-permissions` and `HUSKY=0`. `verify` runs on pull requests and pushes to `main`, and the `verify` ruleset blocks a merge until it passes on an up-to-date branch with no bypass (2026-10-31).
- **A new worktree has no setup.** Run `npm ci`, then `npm run worktree:setup`, before any type-check, test, commit or push. A worktree whose `node_modules` is a junction to the main checkout skips `npm ci` but still needs `npm run worktree:setup`. `prepare` writes `server/generated/version.ts` and `app/paraglide/`, and it only runs on `npm ci`/`npm install`; without them the failure reads `Cannot find module './generated/version'` or `~/paraglide/messages`. The hooks and `type-check` scripts now stop early and say which step is missing.
- **Run the pre-push gates before pushing**: `git push --dry-run -u origin <branch>` runs `.githooks/pre-push` against the real refs (dependency advisories; QuickBooks live contract when `server/services/qbo/` or `tests/contract/qbo/` changed; worker bundle size when bundle paths changed) and sends nothing. Fix what it reports, then push. On a machine with no connected Intuit sandbox (the owner's PC, decision 2026-11-10), push a change that really touches QuickBooks with `SKIP_QBO_CONTRACT=1 git push`; the hook prints that the lane was skipped. Only that lane: never skip the advisory or bundle gates.
- `npm run dev` builds then runs wrangler dev (real workerd, no HMR); `npm run dev:hmr` is the fast loop, and `workers/app.ts` must keep its top-level import graph tiny.
- `npm run dev:tunnel` is PUBLIC while running (collab WebSockets need it); stop it when finished.
- `npm run type-check:api` is the fastest loop for `server/` work. `.types/` is generated and gitignored: never commit it.
- `npm run test:contract:live` hits a real third-party API and needs a connected Intuit sandbox.
- Database is drizzle-kit schema-first: `server/lib/db/schema` is the source of truth, `npm run db:generate` writes the forward migration, `npm run db:check` is the drift gate.
- All source, comments, docs, commit messages and user-facing strings are English only (`npm run lint:english` checks source).

## Where to read before you touch it

- Scripts and their gotchas: [`docs/reference/dev-workflow.md`](docs/reference/dev-workflow.md).
- Architecture, auth, tenancy modes, the `wrangler*.jsonc` files (which one wins): [`docs/reference/architecture-notes.md`](docs/reference/architecture-notes.md). `useOfflineQueue` was RETIRED in #181; do not reach for it. `packages/shared-ui/src/index.ts` is the authoritative component list; read it.
- Adding, renaming or changing the default of an env variable or binding: [`docs/reference/environment-variables.md`](docs/reference/environment-variables.md).
- Placing a spec: run `npm run lint:tests` ([`docs/reference/testing-layout.md`](docs/reference/testing-layout.md), `docs/develop/testing.md` §1). `workers/app.ts` is the single worker entry.
- Rules a reviewer applies live in [`CODING_STANDARDS.md`](CODING_STANDARDS.md); the gate registry (`scripts/lib/gate-registry.mjs`) and `eslint.config.js` hold the mechanical ones and print their own fix. Read the matching section first:
  - Authentication, JWTs, cookies, sessions: "JWT & auth". A slip reintroduces a critical vulnerability.
  - An endpoint that takes input: "Input validation" (Zod).
  - Logging: "Logging".
  - A query, route or table: "Tenant isolation" (`tenantId` from the verified JWT only; every query scoped).
  - A new table or column, a migration, a column retirement: "Schema".
  - A code comment: "Comments".
  - A client-portal or agent-portal entity shown in both: "Cross-portal reuse".
  - Writing tests: "Tests".

## Agent skills

- **Issue tracker**: GitHub Issues on `NCHILLC/OpenInspection`, driven with `gh ... --repo NCHILLC/OpenInspection`. Target this repo only; `upstream` is public and filing there is not ours to do.
- **Triage labels**: the five `triage` roles map to same-named labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`; category roles are `bug` and `enhancement`.
- **Domain docs**: single context. Terms are the table below plus `docs/develop/conventions/i18n-glossary.md` for UI strings.

## Product Terminology (canonical)

User-facing copy and NEW code identifiers use these terms. Existing surfaces are renamed in a dedicated terminology pass, apart from feature work.

| Use | Not |
|---|---|
| **Inspection** | Order, Job |
| **Company** (name/branding settings) | Workspace (user-facing) |
| **Repair Items** | Recommendations (user-facing) |
| **Canned Comment** (library entry) | "Comment" unqualified; distinguish from per-inspection **Notes** (inspector free text) |
| **Client** / **Agent** (contact types) | Customer |
