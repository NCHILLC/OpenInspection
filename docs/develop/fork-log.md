# Fork log

`NCHILLC/OpenInspection` (`origin`) is a **public** copy of
`InspectorHub/OpenInspection` (`upstream`) — public since it was created
(2026-08-27), so everything committed here, history included, is world-readable.
It is not a GitHub-network fork (`gh repo view --json isFork` is `false`), so a
pull request cannot be opened from it into upstream; contributions need a real
fork under another name. Since 2026-09-13 new work goes upstream rather than
here; which fork commits to send, hold or keep is sorted in
[`upstream-contribution-ledger.md`](upstream-contribution-ledger.md). This file records what has been
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

## Merge — 2026-09-14, upstream `8ba7467b..c9ba8112` (46 commits, PR #353)

The second of three pieces (the rest: #354–#356). No migration changes, so this
one deploys without the baseline reconcile piece 1 needed. Taken **wholesale**
apart from the agent-portal UI, below.

**Twenty-two paths conflicted — nine of them modify/delete against the fork's
agent-portal removal (`2172d817`), thirteen content.**

**Agent portal: kept deleted, and four more files removed.** Upstream did real
work on the agent portal in this range (`bb518f3` refuses non-agents at the
door, `216f548` gates the terms clauses), and its UI half has nowhere to live
here. The nine modify/delete conflicts were resolved with `git rm`, and four
files upstream ADDED in this range went the same way because their only callers
were pages this fork does not have: `app/components/agent/AgentSignupPanel.tsx`,
`AgentUserMenu.tsx` and its test, and `app/routes/agent-layout.test.tsx` (which
imports the deleted route). `app/routes.ts` registers no agent page after the
merge — upstream's only change to it in this range adds `resources/contact-search`.

**`app/lib/agent-portal-access.server.ts` was KEPT**, with its test, although
the loader that called it is gone. It is app-tier policy, not a page, and the
fork already keeps its sibling `agent-terms.server.ts` on the same footing; both
are reachable by `knip` through their own specs, so neither is dead weight the
gate can see. If the portal ever returns, upstream's reasoning returns with it.

**Server-side agent work was taken in full** — `server/api/agent.ts`'s role
refusal, the agent-terms gate, and upstream's two new gate scripts
(`check-agent-terms.mjs` with its self-test, `report-agent-acceptance.mjs`).
Neither reads a UI path, so both run green here.

**Code conflicts, and what each kept:**

- `server/lib/mcp/oauth-provider.ts`: both. Upstream's `allowPlainPKCE: false`
  (S256-only — `plain` returns a stolen authorization code to being usable) sits
  on top of the fork's endpoint constants from `oauth-paths.ts`, which the lazy
  MCP/OAuth gate reads so the two cannot drift.
- `server/lib/migration-intake/formats/xlsx-sheet.ts`: both, and a re-saved
  workbook needs both. The fork's attribute parse still resolves `t="s"` cells
  through `sharedStrings.xml`; upstream's `inlineStringOf` is now the fallback
  when a cell carries no `<v>` at all. One cell has one form or the other, never
  both, so the fallback cannot mask a value.
- `RatingSegment.tsx`: upstream's F56 fix taken whole — the label swap moves
  from a viewport breakpoint to a per-TILE container query, and the label span
  becomes `block` so `truncate` can finally clip. The fork's 14/16px type and
  its `icon` tile survive. ⚠️ Upstream's `6.5rem` threshold was measured at
  13px; this fork renders `md` tiles at 16px, so it is conservative rather than
  exact here and a near-fitting label gets an ellipsis. Taken unchanged: the
  ellipsis is the fallback upstream designed for, and at phone widths every tile
  is far below the threshold either way.
- `NotesFieldHeader.tsx`, `CannedCommentTabs.tsx`: upstream's contrast fix
  (`text-ih-fg-4` → `fg-3`, which did not clear AA at these sizes) on the fork's
  phone type sizes. The canned-comment body keeps the fork's inline-edit
  textarea and `htmlToPlainText`; its `isIncluded ? fg-3 : fg-3` collapsed to
  one class, since upstream's fix left both arms the same token.
- `PublishModal.tsx`: upstream's revision-reason box (`isAmendment`,
  `PublishExtras`, the receipt) and its corrected "what publishing actually
  does" copy taken; the fork's 15/16px sizes kept on the lines it had changed.
  The new textarea keeps upstream's own smaller type — see the PR.
- `AnnotationToolbar.tsx`: the fork's 44px tool targets and literal white kept.
  Upstream converged on raw `white/*` for the same reason in this range, but
  left the ACTIVE glyph on `text-ih-fg-inverse`, which is the same flipping
  token one state over; upstream's `ds-allow` comment was taken.
- `PhotoAnnotator.tsx`: upstream's `usePhotoSource` and `AnnotatorPlaceholder`
  taken (a failed photo load is now told apart from an empty one). Upstream's
  `MeasureCalibration` import was NOT — Measure is removed here and the
  component does not exist.
- `app/lib/forms/auth.schema.ts`: the fork's deletion stands. Upstream's change
  renames a field on `makeAgentLoginLinkSchema`, whose page `2172d817` deleted;
  nothing else in the file moved.
- `messages/{en,es-419}/editor-3.json`: every key from both sides, 125 each, no
  duplicates, the two locales in step.

**Two things the merge SURFACED rather than caused**, both fixed here rather
than papered over:

- **`sun` never restated `--ih-primary-fg`.** Upstream `5e36d52` declared that
  token per theme and removed the `@theme` alias's `#ffffff` fallback, which is
  what finally made it measurable. The fork's sun block overrides `--ih-primary`
  to indigo-700 and did not restate the on-fill foreground, so the gate's
  declaration-order cascade handed it dark/field's near-black: **#0f172a on
  #4338ca, 2.26:1, at 26 call sites** — every filled button on the theme meant
  for a phone in direct sun. White is 8.6:1 on that fill, which the block's own
  comment already says for the link half. `sun` was added to the
  `--ih-primary-fg` token invariant in `scripts/lib/palette-invariants.mjs` so
  the restatement is enforced rather than remembered; a positive control (the
  token set back to #0f172a) confirms the invariant reports it.
- **`tests/unit/tooling/contrast-gate-blind-spots.spec.ts`** (new upstream, in
  this range) retyped `['light', 'dark', 'field']` in three places. This fork
  has a fourth theme. The two that mean "every theme reports" now DERIVE the
  list from the gate's own `THEMES`, so the next theme cannot silently narrow
  the claim; the third genuinely reads `['light', 'sun']`, because a fixed dark
  chrome fails in exactly the themes whose foreground is dark and sun is a white
  ground with near-black type.

**Baselines.** `scripts/file-size-baseline.json` re-snapshotted at merged sizes
(upstream's copy caps none of the fork's own large files) — the same reviewed
decision as the last two merges. Two files grew *because of* this merge:
`template-edit.tsx` 734 (fork 719, upstream 723 — both sides added), and
`CannedCommentTabs.tsx` 464, one line, for the note on the resolution above.
`scripts/middleware-budget-baseline.json` regenerated against the merged tree:
132 → 135 tracked files and 537 → 541 `$`-method refs, all of it upstream's
three new app-tier modules (`booking-open.server.ts`,
`action-followup.server.ts`, `resources/contact-search.tsx`); the two numbers
that would matter, `globalMiddlewareUse` (12) and `apiWorker` (9), did not move.
`scripts/unread-fields-baseline.json` needed no entry — the gate is green as it
stands. `package-lock.json` did not conflict and is unchanged: upstream's
`package.json` change in this range is scripts only, no dependency moved.

## Merge — 2026-09-13, upstream `ac02ba3e..8ba7467b` (55 commits, through PR #352)

The first of three pieces bringing the fork current (the rest: PR #353, then
#354–#356). Pieces are cut at upstream merge commits so each one lands, passes CI and
can be deployed on its own. Taken **wholesale**.

**This range includes v2.0.0's rebuilt migration baseline** (`c5e64bac`). The fork
carries no migrations of its own, so nothing here conflicts, but a deployed D1
does **not** pick the change up by migrating: follow "Upgrading across a rebuilt
baseline" in `docs/operate/upgrade.md` (back up first) **before** deploying this
merge.

**Four files conflicted, none of them code.**

- `CLAUDE.md`: upstream's refreshed frontend summary and its quality-gates lead
  paragraph taken; the fork's paragraphs after it (gates before writing,
  preflight, worktree location, the `verify` ruleset) kept.
- `docs/develop/architecture.md`: upstream's component/hook summary taken. The
  field-surface list stays the fork's: upstream's now says photo upload is not
  offline-capable, which is false here (`85669e05` queues it), and the
  capture-first client is this fork's decision.
- `package-lock.json`: upstream's taken, then `npm install` re-resolved it
  against the merged `package.json` (every `resolved` URL on the public
  registry, as upstream's `lint:lockreg` requires).
- `scripts/file-size-baseline.json`: upstream's copy has no caps for the fork's
  own large files, so it was re-snapshotted at merged sizes
  (`check-file-size.mjs --update`), the same reviewed decision as the 09-07
  merge. No file grew because of this merge.

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
  `/company/` prefix <!-- no-portal-routes-allow: naming the retired prefix, not documenting a route -->; the fork's lazy-gate spec and the predicate's comment
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

**Two CI-only gates upstream added inside this window** (`b9cdb712` middleware
budget, and `lint:no-portal-routes`) were never in the fork's smaller pre-commit
rung, so their first run was in PR CI, not locally. Both were re-baselined
rather than papered over:

- `lint:middleware-budget`: `template-edit.tsx`'s fan-out moved 3 -> 4 in
  upstream's own baseline update. The 4th call, `contractorTypes.$get`, is fork
  work that predates this merge, not something the merge resolution added; the
  baseline was authored against upstream's tree, which has no contractor types.
  Ten agent-portal route entries also dropped out on the same re-baseline —
  legitimately, since `2172d817` deleted those files.
- `lint:no-portal-routes`: the SaaS-mount line above, naming the prefix that no
  longer applies, is exactly the negative statement the gate's own docstring
  warns about — it needed the documented allow-comment, not a rewrite.

## Fork deviations

What this fork changed and intends to keep. Add a line when a change is a
deliberate departure rather than work upstream simply has not done yet.

| Area | What | Why it diverges |
|---|---|---|
| `editor` (20 commits) | Field capture on a phone: camera, offline defect photos, shutter gesture handling, mobile layouts | Upstream's field surface is responsive web; this fork treats crawlspace capture as a core requirement — see the capture-first decision in `architecture.md` |
| `media` (2026-09-08 field eval) | Camera holds its stream across parent re-renders; the in-camera edit badge opens the defect annotator for a defect session; annotator marks scale with the photo, freehand and arrow take touch (arrow is drag-to-draw), Pan and Measure tools removed, toolbar text is literal white | Upstream has none of these (`git log main..upstream/main -- app/components/media-studio app/components/editor/FieldCamera.tsx` is empty). Measure is a deliberate removal, not a fix: its first-use calibration dialog read as a broken tool mid-inspection |
| `sun` theme | A fourth `data-color-scheme`: white ground, near-black type, 18px base, for a phone in direct sun | Upstream has three themes and `field` is dark-based, which is right for a crawlspace and wrong on a roof at noon. Every upstream change that counts themes or names them (`scripts/lib/contrast-css.mjs`'s `THEMES`, the palette invariants, any spec that retypes the list) needs a fourth answer on merge — the 09-14 merge above is what that costs |
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
