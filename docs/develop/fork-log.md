# Fork log

`NCHILLC/OpenInspection` (`origin`) is a private fork of
`InspectorHub/OpenInspection` (`upstream`). This file records what has been
taken from upstream, what has been deliberately skipped, and where the two have
diverged on purpose.

It exists because the alternative is re-deriving those answers from a diff every
time upstream moves. Without it, a fix that upstream already made gets
rewritten here, and a deviation this fork chose gets "fixed" back to upstream's
behaviour by someone who assumed it was drift.

**This is a decision log, not a changelog.** Only entries where a judgement was
made belong here. A commit range taken wholesale with nothing to say about it
does not need a line.

## Refreshing the numbers

```bash
git fetch upstream
git rev-list --left-right --count upstream/main...main   # upstream-only, fork-only
git log -1 --format='%h %ad %s' --date=short $(git merge-base upstream/main main)
git cherry upstream/main main                            # '-' marks fork commits upstream already has
```

`git cherry` is the reason the PR template forbids squashing: a squash rewrites
the branch's commits, and `git cherry` then reports landed work as unmerged.

## The upstream mirror

`upstream-track` is a branch on `origin` holding **exactly** `upstream/main` —
all of upstream's commits, none of this fork's. It exists so upstream can be
run, deployed and diffed without touching the working line.

Two rules, and they are the whole contract:

- **Never commit to it.** A commit here turns the mirror into a third divergent
  line, which is the one thing it exists to prevent.
- **Fast-forward only.** If a refresh ever refuses to fast-forward, something
  has been committed to it — fix that rather than forcing the update.

```bash
git fetch upstream
git push origin upstream/main:refs/heads/upstream-track   # refresh the mirror
git switch upstream-track && git merge --ff-only upstream/main   # or locally
```

It tracks `origin/upstream-track`, **not** `upstream/main`, and that is not an
oversight to correct: tracking upstream would make a stray `git push` on this
branch aim at somebody else's repository. Refresh with the explicit commands
above.

CI does not run on it: the `push` trigger is scoped to `main`, deliberately.
Upstream tests its own commits, and a mirror burning runner minutes to confirm
that is waste.

When an upstream scope in the table below is decided as **take**, this branch is
what you merge from.

## Snapshot — 2026-09-07, after the merge below

| | |
|---|---|
| Merge base | `ac02ba3e`, 2026-09-07 (upstream PR #344) |
| Upstream-only commits | 0 |
| Fork-only commits | 47 plus the merge |
| Fork commits upstream already has | 0 — nothing has been contributed back |

## Merge — 2026-09-07, upstream `f1198ffa..ac02ba3e` (232 commits)

Taken **wholesale**, `statutory` included. Tagged `pre-upstream-2026-09-07` on
`main` before starting.

**`statutory` — taken, carried dormant.** Authority-issued PDF forms (TX TREC
REI 7-6; FL Citizens four-point, roof and OIR-B1-1802). North Carolina mandates
no form and NCHI serves Charlotte only, so it has no use here today. It was
taken anyway because it cannot be left out: the 74 scoped commits are ~128 of
the 232 once the overlay renderer, gate, marketplace and editor commits filed
under other scopes are counted, and 80 of the remaining commits touch files it
also touched. A merge cannot exclude commits; excluding it is a permanent
cherry-pick regime. It is inert without an authority's PDF in R2 hashed against
its field map — `produce` refuses by design. Cost carried: four empty tables,
four other-state seed templates in the library, four gates.

**Fifteen files conflicted; five were code.** Resolved toward the fork's
phone-capture behaviour throughout:

- `inspection-edit.tsx`: fork's drill shell kept; upstream's Inspection Details
  overview and revision banner ported into it (`3cfe124d`, `759425e4`).
- `ItemList.tsx`, `ItemEditor.tsx`: upstream's indent and heading components
  taken; the fork's phone font sizes and 56px row target carried into them.
- `template-edit.tsx`: upstream's extracted save serializer taken; the fork's
  `abbrev`, `choices` and `recommendedContractorTypeId` wire fields moved into
  `app/lib/editor/serialize-template.ts`.
- `di.ts`, `workers/app.ts`: both sides kept (fork's R2 branding argument and
  lazy MCP import; upstream's per-request memo and scheduled-handler split).
- `inspection-report.service.ts`: upstream moved the canned-comment types to
  `report-schema-types.ts`; the fork's `choices` field followed them.

**Taken from upstream in place of fork work** (not deviations — the fork's
version is gone):

- Team page invite link: upstream's modal (`settings_team_invite_link_*`)
  supersedes the fork's copy-link button.
- Bundle gate: upstream's `wrangler check startup` entry-chunk ceiling replaces
  the fork's hand-rolled static-closure walker (`cf7a4999`). Same Error 1102
  risk, measured with a supported command.
- `lint:agent-routes` stays removed — it went with the fork's agent-portal
  removal (`2172d817`) and nothing references it.
- SaaS MCP mount is `/mcp/{slug}` (upstream `a4620cd1`), no longer the broad
  `/company/` prefix; the fork's lazy-gate spec and the predicate's comment
  were updated to say so. No code change.

**A silent clash the merge did not flag**: both sides had added the same lazy
loader for the 900 KB OpenAPI snapshot in `server/durable-objects/inspector-mcp.ts`
(fork `cf7a4999`, upstream discussion #325). The auto-merge kept both; `tsc`
caught the redeclaration. Upstream's copy kept.

**File-size baseline**: locked at merged sizes. Two files grew past every
reviewed cap *because* of the merge and were bumped as a reviewed decision:
`ItemList.tsx` 425 (both sides added), `collab-findings-api.ts` 449 (upstream's
attribute write on top of the fork's photo ops). Every other raised cap is one
upstream had already reviewed.

**Line endings**: upstream's `.gitattributes` (`* text=auto eol=lf`) now
governs; the Windows working tree was renormalised with `npm run lint:eol -- --fix`.

## Fork deviations

What this fork changed and intends to keep. Add a line when a change is a
deliberate departure rather than work upstream simply has not done yet.

| Area | What | Why it diverges |
|---|---|---|
| `editor` (20 commits) | Field capture on a phone: camera, offline defect photos, shutter gesture handling, mobile layouts | Upstream's field surface is responsive web; this fork treats crawlspace capture as a core requirement — see the capture-first decision in `architecture.md` |
| `ratings` (4) | "Not inspected" reasons, Safety-Major level | — |
| `intake` (3) | Graded defects filed by position, severity preserved on import | — |
| CI | `verify` also runs on pushes to `main` | Fork commits directly to `main`; upstream works through PRs |
| `package.json` `allowScripts` | Kept (upstream removed it); each new native-package version is added by hand | This machine's npm refuses install scripts not on the list, so a wrangler or better-sqlite3 bump that is not added here leaves workerd and the SQLite binding unbuilt with only a warning |

## Rules

- One line per decision, citing a commit or range (`git log a..b`), never a
  migration number or a PR number from the other repository without its owner
  (`InspectorHub/OpenInspection#324`).
- Record skips as explicitly as takes. "We looked and said no" and "we never
  looked" are the same silence otherwise.
- Update the snapshot when you fetch, not when you remember.
