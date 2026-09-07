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

## Snapshot — 2026-09-07

| | |
|---|---|
| Merge base | `f1198ffa`, 2026-08-29 (upstream PR #324) |
| Upstream-only commits | 254 |
| Fork-only commits | 47 |
| Fork commits upstream already has | 0 — nothing has been contributed back |

Divergence is nine days old and upstream is moving fast: 254 commits in that
window. The triage below is by **scope**, not by commit, because 254 individual
decisions is not a thing anyone will finish.

## Upstream work, by scope

| Scope | Commits | Decision |
|---|---|---|
| `statutory` | 74 | **undecided — the big one.** A whole subsystem: statutory form definitions, readiness checks, publishing, an editor surface and the first statutory E2E. Nothing in the fork depends on it. Taking it means carrying a subsystem the fork has no requirement for; skipping it means every future upstream merge conflicts against a version of the editor that assumes it exists. |
| `editor` | 14 | **undecided — see collision zone below.** |
| `gates` | 13 | recommend taking. Gate and lint work is exactly what the fork wants more of, and it rarely conflicts. |
| `marketplace` | 9 | undecided. Likely on the removal list. |
| `perf` | 8 | recommend taking. |
| `mcp` | 6 | undecided. Named on the eval's removal list. |
| `auth` | 6 | recommend taking — security-path changes are the worst class to re-derive. |
| `templates` | 5 | undecided; overlaps fork template work. |
| everything else | ~40 across `ui`, `tenancy`, `settings`, `routing`, `deps`, `ci`, `cron`, … | case by case |

Counts are `--no-merges` and exclude 22 merge commits.

## Collision zone: `app/components/editor`

The one area both sides are actively changing, and the reason a blind merge will
hurt.

- **Fork**: 20 of its 47 commits are scoped `editor`, touching 60 files under
  `app/components/editor`. The subject is *field capture on a phone* — camera,
  offline photo queueing, shutter gestures, mobile layout, a way out of the
  unsaved-changes blocker.
- **Upstream**: 14 `editor` commits, nearly all of them *statutory-driven* —
  statutory groups as slots, item nesting, sub-item CRUD, revision display.

Same directory, different concerns, so most conflicts will be textual rather
than semantic. Two exceptions worth checking before assuming that:

- `fix(editor): the Inspection Details overview rendered nothing on a phone` —
  upstream fixing a mobile bug this fork may have already solved differently.
- `refactor(editor): template item CRUD delegates to the shared tree ops` — a
  structural refactor under files the fork has rewritten.

## Fork deviations

What this fork changed and intends to keep. Add a line when a change is a
deliberate departure rather than work upstream simply has not done yet.

| Area | What | Why it diverges |
|---|---|---|
| `editor` (20 commits) | Field capture on a phone: camera, offline defect photos, shutter gesture handling, mobile layouts | Upstream's field surface is responsive web; this fork treats crawlspace capture as a core requirement — see the capture-first decision in `architecture.md` |
| `ratings` (4) | "Not inspected" reasons, Safety-Major level | — |
| `intake` (3) | Graded defects filed by position, severity preserved on import | — |
| CI | `verify` also runs on pushes to `main` | Fork commits directly to `main`; upstream works through PRs |

## Rules

- One line per decision, citing a commit or range (`git log a..b`), never a
  migration number or a PR number from the other repository without its owner
  (`InspectorHub/OpenInspection#324`).
- Record skips as explicitly as takes. "We looked and said no" and "we never
  looked" are the same silence otherwise.
- Update the snapshot when you fetch, not when you remember.
