# CLAUDE.md — OpenInspection (Open Source Edition)

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

Scripts are in `package.json`; commentary on each: [`docs/reference/dev-workflow.md`](docs/reference/dev-workflow.md). Gotchas it does not confess:

- `npm run dev` builds then runs wrangler dev (real workerd, no HMR). `npm run dev:hmr` is the fast loop, and `workers/app.ts` must keep its top-level import graph tiny.
- `npm run dev:tunnel` is PUBLIC while running (collab WebSockets need it); stop it when finished.
- `npm run type-check:api` is the fastest loop for `server/` work. `.types/` is generated and gitignored: never commit it.
- `npm run test:contract:live` hits a real third-party API and needs a connected Intuit sandbox.
- Database is drizzle-kit schema-first: `server/lib/db/schema` is the source of truth, `npm run db:generate` writes the forward migration, `npm run db:check` is the drift gate.

## Key Files & Directories

`workers/app.ts` is the single worker entry. Where a spec goes is decided by `npm run lint:tests` (table: [`docs/reference/testing-layout.md`](docs/reference/testing-layout.md), rules: `docs/develop/testing.md` §1).

## Architecture

How the single worker, auth, tenancy modes, inspection engine, frontend and the `wrangler*.jsonc` config files (which one wins, what each tracks) fit together: [`docs/reference/architecture-notes.md`](docs/reference/architecture-notes.md). Two standing rules from it:

- `useOfflineQueue` was RETIRED with the rest of the bespoke offline layer in #181; do not reach for it.
- `packages/shared-ui/src/index.ts` is the authoritative component list. Do not maintain a count or list of components in docs: read the file.

## Environment Variables

Table of every variable and binding: [`docs/reference/environment-variables.md`](docs/reference/environment-variables.md). Read it before adding, renaming or changing the default of one.

## Coding standards

Mechanical rules live in gates (`scripts/lib/gate-registry.mjs`) and lint (`eslint.config.js`), which print their own fix. Rules a reviewer applies live in [`CODING_STANDARDS.md`](CODING_STANDARDS.md); read the matching section before touching:

- **JWT, cookies, sessions**: any code that touches authentication. Violations reintroduce critical vulnerabilities.
- **Input validation**: Zod on every endpoint that takes input.
- **Tenant isolation**: `tenantId` from the verified JWT only; every query scoped.
- **Schema**: a new table or column, a migration, or a column retirement.
- **Logging**, **comments**, **cross-portal reuse**: a client-portal or agent-portal entity shown in both.

## Quality gates

CI is a strict superset of pre-commit, not the same set (what each runs: [`docs/reference/dev-workflow.md`](docs/reference/dev-workflow.md#quality-gates-mechanism)). `verify` is the authoritative gate (a required status check). The pre-commit hook is a fast local guard.

**Run the gates BEFORE writing, not at commit.** `npm run lint:gates` is the
pre-commit rung and takes seconds. Paying it up front tells you straight
away that (say) a file is at its size cap, where finding out at commit time
means discovering it after a multi-minute eslint pass, an hour into work that
now has to be restructured.

**Run `npm run preflight` before trusting anything a dev server says.** It
checks for worktrees shadowing the checkout, a build that is not HEAD, and a
port that looks alive but is not. Add `--url http://localhost:5173` to compare
the SERVED commit against HEAD.

**Worktrees belong OUTSIDE this checkout** (`../oi-worktrees/`, not
`.claude/worktrees/`). A worktree inside the repo makes the preview launcher serve ITS build on the expected port, so every observation is about other source; an absolute path in `launch.json` does not help.

**`--no-verify` is blocked**, with `--dangerously-skip-permissions` and
`HUSKY=0`, by a PreToolUse hook (`~/.claude/hooks/block-verify-skip.mjs`).
`verify` runs the whole suite on pull requests and on pushes to `main`, and it
**blocks a merge**: the `verify` ruleset requires it on the default branch, with
the branch up to date and no bypass (2026-10-31). The muster crew uses the same
GitHub account as the owner, so a bypass would be a bypass for them too.
If a gate fails, fix the cause.

## Agent skills

- **Issue tracker**: GitHub Issues on `NCHILLC/OpenInspection`, driven with `gh ... --repo NCHILLC/OpenInspection`. Never target `upstream` (`InspectorHub/OpenInspection`); filing there is public and not ours to do.
- **Triage labels**: the `triage` skill's five roles map to the same-named labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Category roles are `bug` and `enhancement`.
- **Domain docs**: single context. Terms are the Product Terminology table below, plus `docs/develop/conventions/i18n-glossary.md` for UI strings. There is no `GLOSSARY.md` or ADR folder yet; create one only when a skill (`domain-modeling`) is asked to.

## Product Terminology (canonical)

User-facing copy and NEW code identifiers use these terms. (Existing surfaces are renamed in a dedicated terminology pass; don't mix renames into feature work.)

| Use | Not |
|---|---|
| **Inspection** | Order, Job |
| **Company** (name/branding settings) | Workspace (user-facing) |
| **Repair Items** | Recommendations (user-facing) |
| **Canned Comment** (library entry) | "Comment" unqualified; distinguish from per-inspection **Notes** (inspector free text) |
| **Client** / **Agent** (contact types) | Customer |
