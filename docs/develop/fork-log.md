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

## Merge — 2026-09-18, upstream `8ba7467b..0dece2f2` (67 commits, through PR #360)

Taken as one merge, not the piece-2/piece-3 split the 09-13 entry planned;
upstream has since moved from #356 to #360. `main` was tagged
`pre-upstream-2026-09-18` (local) before finishing. 23 files conflicted. No
migrations arrive with it. Fork-only commits before the merge: 120.

**Taken from upstream in place of fork work**

- Report release gate: upstream's `f2ad2570` / `a1541b7f` replace the fork's
  `71fa3e26` (owner decision, 2026-09-14, recorded in the ledger). That commit
  touched exactly the five conflicting files and nothing else, so taking
  upstream's whole loses no other work. The ledger's follow-up, that upstream's
  photo door still re-resolves the gate once per photo, is **not** done here.
- `todayInZone`: upstream added the same function independently. The auto-merge
  kept both definitions and `tsc` would have refused the duplicate. Upstream's
  stays: its fallback for a blank or unknown zone is the browser's own day,
  where the fork's fell back to UTC. The wizard reads upstream's
  `useSchedulingTimeZone` rather than `useDisplayTimeZone`.
- Editor text colour: upstream's `text-ih-fg-3` in place of `fg-4`
  (`NotesFieldHeader`, `CannedCommentTabs`), which is what its new contrast gate
  enforces. The fork's font sizes stay.
- Publish dialog: upstream's corrected body copy and amendment-summary field, at
  the fork's sizes (+3 px on upstream's, as elsewhere in the file).

**Both sides kept**

- `oauth-provider.ts`: the fork's shared path constants from `./oauth-paths`,
  plus upstream's `allowPlainPKCE: false`.
- `xlsx-sheet.ts`: upstream reads inline strings but still not
  `sharedStrings.xml`, so `006f2eab` is **not** superseded. The loop reads
  `<v>`, then inline text, then resolves `t="s"` indexes.
- Annotator: upstream's `usePhotoSource` and `AnnotatorPlaceholder`; the fork's
  Measure removal (no `MeasureCalibration` import) and its toolbar touch targets
  and literal-white text, under upstream's `ds-allow` note.
- Wizard: `wizardBlockedReason` (fork; gates every step passed) on top of
  upstream's `stepBlockedReason`, plus upstream's `orderTemplatesForPicker`.
  The fork's own test looked for the label `Template`; upstream's is
  `Report template`.

**The agent portal stays removed** (`2172d817`). Files that arrive only to serve
the deleted UI were dropped: `AgentSignupPanel`, `AgentUserMenu` and its test,
`agent-layout.test.tsx`, `agent-portal-access.server.ts` and its test (its only
consumer was the deleted layout), and `makeAgentLoginLinkSchema`.
`server/api/agent*.ts` and its specs stay.

**Security hold lifted.** GHSA-cq23-3742-44fj was published 2026-09-15 and
upstream shipped its fix (`a27c07c5`), which is what the ledger's hold on
`bda22908` was waiting for. That commit is now in `main`'s history alongside
upstream's adapted version of the same fix.

**Gates.** File-size baseline re-snapshotted. Four files grew *because of the
merge* (both sides added lines) and were bumped as a reviewed decision:
`NewInspectionWizard.tsx` 561, `template-edit.tsx` 733,
`server/api/inspections/publish.ts` 590, `inspection-doc.ts` 1050. Middleware
budget re-baselined: `template-edit.tsx`'s fourth call is the fork's
`contractorTypes.$get`, as on 09-07, and ten agent routes left it. The
submit-guard baseline is upstream's plus the fork's reviewed exemption for the
offline photo-upload queue, which taking upstream's copy had dropped. The
contrast gate failed 26 times on one cause: the sun theme overrides
`--ih-primary` but had not restated `--ih-primary-fg`, which upstream's
`5e36d526` made a per-theme token with no fallback. The sun block now restates
it as white, the value a browser already gave it, so nothing renders differently.

**Unverified.** `RatingSegment` keeps upstream's `6.5rem` container-query
threshold, pinned by upstream's own test and sized for 13 px text. The fork's md
tiles carry 16 px, so a long full label ("Not Inspected") can clip just above the
threshold. Check a three-up rating row on a phone.

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
| `ratings` (4) | "Not inspected" reasons, Safety-Major level | — |
| `intake` (3) | Graded defects filed by position, severity preserved on import | — |
| CI | `verify` also runs on pushes to `main` | Fork commits directly to `main`; upstream works through PRs |
| `schema` docs (`5b6cfed4`) | Documented what `inspections.date` actually stores — naive `...Z` wall-clock timestamps from three write paths, mixed with bare `YYYY-MM-DD` rows from legacy/manual creation — in place of comments describing a normalized end-state that was never reached, and pinned the shape with a same-call parity spec across past/today/future buckets. No behaviour change | Fork-only. Upstream's only touch to the same file, `ff80b583`, is an unrelated PCA cost-visibility change (`showEstimates` gating) — not date handling — so there is no competing fix to reconcile |
| `billing`/`team`/`metrics` (`c1aec37e`) | `markPaid` now refuses a voided invoice, `removeMember` now refuses to remove a workspace's last owner, and every metrics aggregate (totals, monthly chart, service mix, referral split, per-inspector) excludes cancelled inspections | Each was a refusal a sibling path already enforced (`recordOfflinePayment`, `updateMember`) but this path didn't. Fork-only — `git log` on the five touched files is empty upstream |
| `editor` hydration (`4ac38e91`) | `useBreakpoint` seeds from a fixed server snapshot via `useSyncExternalStore` instead of reading `matchMedia` on the client's first render | The mismatch (React #418) rebuilt the whole field editor from scratch on every phone load, the exact device it exists for. Fork-only — no upstream history on this hook. Distinct from the phone-capture `editor` row above: that one is a feature scope, this is a hydration bug |
| `auth` (`bda22908`) | `/2fa/setup` now refuses when a factor is already live (only `/2fa/disable` can turn one off), password-reset lookup is tenant-scoped like login's, and the authenticated 2FA code endpoints share `/login`'s rate limiter | Each gap had a sibling path that already enforced it. Fork-only — no upstream history on `auth.ts`, `auth/totp.ts`, or `auth.service.ts` when it was written. Reported as GHSA-cq23-3742-44fj (published 2026-09-15); upstream's fix is `a27c07c5` |
| `scheduling` (`8994e0cd`) | The generic `PATCH /inspections/:id` now runs the same capability/closed-day/overlap refusal as the dispatch board's dedicated `/schedule` endpoint, via a shared `lib/schedule-guard` both routes call | The calendar's civil-day drag bypassed every policy the dispatch board's instant-drag enforced. Fork-only — no upstream history on `inspections/core.ts` or `inspections/schedule.ts` |
| `reports` publish/access (`aee86da6`, `27f9f9de`, `71fa3e26`) | Report-version lookups now scope by `reportId`, not inspection alone (fixes an arbitrary tie on multi-report orders); publish now flushes the collab Durable Object before reading or freezing a snapshot (it also enforced `computePublishReadiness` server-side, reverted to a warning by `140720a3` on 2026-09-13); the public report/photo/PDF handlers now gate on the same payment-and-agreement resolver the Hub's own lock notice already read | Three independent gaps on one path, each already correct somewhere adjacent (the scoped `snapshotOnPublish` write, the readiness comment nobody wired up, `getReportGate`'s resolver). Fork-only — no upstream history on any of the six touched files. The e2e that should have caught the access gap had been `describe.skip`'d since Sprint 1. The public-handler gate (`71fa3e26`) was superseded by upstream's on 2026-09-18 |
| `gates` baseline (`ce03cde3`) | File-size baseline re-snapshotted for the reports/publish/auth/scheduling fixes above, which grew six already-over-cap files (including a Durable Object) | Reviewed-decision path the gate itself documents, taken over splitting those files to satisfy a line count; every growth is a refusal with a test that fails without it. Not itself a behavioural change |
| `pwa` offline (`ca90a94d`, `f54f17ee`) | Offline reload now renders the inspection instead of root's error boundary — `useInspectionPrefs` loads via a plain fetch with a catch instead of a React Router fetcher, whose failure escalates to the nearest route boundary; the service worker's API-caching branch is removed, since it matched route names rather than ids (`dashboard`, `templates`, … all matched) and never fired at all under the Token Relay BFF (loaders call `API_WORKER` in-process, so the browser issues no `/api/inspections/:id` request to intercept) | Fork-only — no upstream history on `useInspectionPrefs.ts`, `inspection-prefs.tsx`, or `sw.js`. Known gap left open on purpose: offline the editor runs on DEFAULTS rather than the workspace's own prefs — closing it needs a localStorage last-known copy, not done here because the page working at all was the P0 |
| `dashboard` overdue (`7ad1ef0c`) | An inspection left `requested` or `confirmed` past its date now lands in the overdue bucket instead of no bucket at all | `needsAttention`'s appointment clause tested only `SCHEDULED`. Fork-only — upstream's only touch to `inspection-analytics.service.ts` is the same unrelated PCA cost-visibility change noted in the `schema` row above, not bucket logic. Deliberately not aged out: an overdue inspection leaves the bucket only by being completed or cancelled |
| `wizard` create/date (`8632b8f7`) | A refused create now keeps the wizard open with the API's own refusal reason instead of silently navigating to `/inspections` (every non-quota failure used to `onClose()`); the date seed now reads the workspace's `today` via `civilToInstantISO`/`todayInZone` instead of the device's local calendar day | Found by an agent-driven QA sweep, not a report. The refused-create half is fork-only. The date-seed half is now upstream's: it added its own `todayInZone` and `useSchedulingTimeZone` (see the 2026-09-18 merge) |
| `package.json` `allowScripts` | Kept (upstream removed it); each new native-package version is added by hand | This machine's npm refuses install scripts not on the list, so a wrangler or better-sqlite3 bump that is not added here leaves workerd and the SQLite binding unbuilt with only a warning |

## Rules

- One line per decision, citing a commit or range (`git log a..b`), never a
  migration number or a PR number from the other repository without its owner
  (`InspectorHub/OpenInspection#324`).
- Record skips as explicitly as takes. "We looked and said no" and "we never
  looked" are the same silence otherwise.
- Update the snapshot when you fetch, not when you remember.
