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

## Cherry-picks — 2026-10-02, upstream `62ae80f3..cf53eb76` (11 non-merge commits: 6 taken, 5 skipped)

Taken as cherry-picks, not a merge: a dry-run merge conflicts on `package.json`,
`scripts/file-size-baseline.json` and two agent-portal files the fork deleted.

**Taken**

- Dependency advisories: `5c270c7a`, `cfe07c22`, `d1a88a48` (PR #18). The pre-push
  advisory gate rejected every push until `brace-expansion` and `undici` moved.
  `5c270c7a`'s `file-size-baseline.json` change was **dropped**: its caps come from
  upstream changes this fork does not have.
- ISN report link: `acc1eb31`, `1d0b3513`. Both are this fork owner's own commits, merged
  upstream. Outbound link and read-back only; `feat/isn-report-sync` is a separate
  line and is not part of this.
- Cron: `8384c149` acks on a self-continuation send failure instead of retrying;
  `wrangler.jsonc` gains `retry_delay: 30` on the cron queue consumer.

**Skipped, deliberately, for now**

- Email provider refactor: `049731cf`, `59fc28e7`, `aba24b84`, `425f7cdb`, `cde57f32`
  (about 50 files; adds a `delivery_failed` signer status and touches the agreement
  schema). It conflicts on two files the fork deleted and wants its own review,
  including whether it ships a migration.

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
`NewInspectionWizard.tsx` 562, `template-edit.tsx` 734,
`server/api/inspections/publish.ts` 591, `inspection-doc.ts` 1051. Middleware
budget re-baselined: `template-edit.tsx`'s fourth call is the fork's
`contractorTypes.$get`, as on 09-07, and ten agent routes left it. The
submit-guard baseline is upstream's plus the fork's reviewed exemption for the
offline photo-upload queue, which taking upstream's copy had dropped. The
contrast gate failed 26 times on one cause: the sun theme overrides
`--ih-primary` but had not restated `--ih-primary-fg`, which upstream's
`5e36d526` made a per-theme token with no fallback. The sun block now restates
it as white, the value a browser already gave it, so nothing renders differently.

**Two upstream specs the fork's code broke, found by CI and not locally** (the
local run picked spec files by keyword and missed both; run whole directories):

- `publish-audit-notify-flags.spec.ts` (new upstream) stubs the database as
  `DB: {}`, and the fork's publish route read it unconditionally to resolve the
  report id for the collab flush, so every publish answered 500. The lookup now
  runs only when the `INSPECTION_DOC` namespace exists: the helper returns
  before using the id otherwise, and the service resolves the report again.
- `contrast-gate-blind-spots.spec.ts` hard-codes three themes; the fork's
  `sun` theme (in the gate's `THEMES`, which caught the 26 failures above) is a
  fourth. Its "every theme" expectations now follow `gate.THEMES`, and the one
  case that is genuinely light-polarity expects `light` and `sun`.

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
| `editor` defect photos (2026-09-20) | The per-defect photo chip (`DefectPhotoChip.tsx`) wraps its thumbnails inside the chip and is capped at its column (`max-w-full`, `flex-wrap`, `min-h-11`) instead of packing them into one fixed-height row | Found in manual validation of PR #353's merge: at ~6 photos the chip ran past its card and squeezed its own label onto two lines. The file's own `ponytail:` note had named this ceiling and its upgrade path. Fork-only — `git log main..upstream/main -- app/components/editor/DefectPhotoChip.tsx` is empty (upstream had no fix to take) |
| `package.json` `allowScripts` | Kept (upstream removed it); each new native-package version is added by hand | This machine's npm refuses install scripts not on the list, so a wrangler or better-sqlite3 bump that is not added here leaves workerd and the SQLite binding unbuilt with only a warning |
| `report` Summary render (`258f4c64`) | The `summary` filter renders the findings, narrowed by `defect_categories.drives_summary`, instead of one per-section count card. Narrowing for all three filters moved into `sectionsForFilter` (`app/lib/report-helpers.ts`), which also took ReportView eight lines back under its ratchet | The two filters were named for each other's behaviour: `itemDrivesSummary` — the tenant's own "include in summary" switch — drove the **Defects** view and the repair-request checkbox, never the Summary, which narrowed nothing at all. A recipient opening Summary read "Roof: 3 defects" with no finding text, location or photo. Fork-first, not a deviation upstream rejected: `git log main..upstream/main` is empty on all seven files this branch touches and the fork is 0 behind, so the same bug is live upstream and this is a candidate to send. The section rule (drop an all-clear section, or keep it saying "All clear") is deliberately left open in-code as `TODO(human)` |
| `editor` summary entry (`2f5a9ed9`) | The editor's preview control opens `?summary=1` as well as the full report — a third `PreviewMenu` row on desktop, a sixth `MobileFinishDrawer` button on mobile (whose `heightFraction` moved 0.42 → 0.5 to match the count) | An inspector reads findings back to a client at the door, and the full report is the wrong document for that. Wiring only: `?summary=1` has been read into `initialFilter` since the PDF pipeline needed it and nothing had ever linked to it. It deliberately opens the SAME page the client opens, so on-site and at-home cannot drift. Fork-only — no upstream history on `PreviewMenu.tsx` or `MobileFinishDrawer.tsx` |
| `report` summary PDF (`214ddd59`) | The export bar offers the condensed PDF beside the full one; `downloadPdf` takes the type as a parameter. The `report_pdfs.type` schema comment corrected and `database-schema.md` regenerated | Publish has rendered and stored a `summary` PDF on every publish since the pipeline landed, and both download endpoints accepted `type=summary` — but every PDF URL under `app/` hard-coded `type=full`, so the artifact was reachable only by hand-editing a query string. No server change: the owner endpoint renders on demand (`getOrRender`), so it needs no pipeline flag and 503s exactly where the full one already does. The old comment credited print-mode CSS with filtering the render does and called the result "defects + safety", which until `258f4c64` it was not |
| `report` Defects filter, **against IA-66** (`e364c2c2`) | The "Defects Only" filter narrows on a new `itemHasDefect` (any finding at all) instead of `itemDrivesSummary`. The Summary reads `drivesSummary`; the repair-request checkbox reads `itemHasDefect` (any included finding can be requested) | **A deliberate reversal of an upstream decision, not drift.** IA-66 pointed the filter and the checkbox at one switch on purpose, and that holds while every category defaults to `drives_summary = true` — the filter then drops nothing. It breaks the moment an operator uses the switch: every category a tenant defines IS a defect (Minor / Moderate / Safety-Major), so unticking Minor removed Minor findings from the only view claiming to list defects, emptying an all-Minor section entirely and leaving no view that showed them all. The switch is a DELIVERY choice and must not change what the report says was found. Spectora, whose model this follows, scopes the same setting to "the summary web report and the summary PDF". Fork-first: `git log main..upstream/main -- app/lib/report-helpers.ts` is empty and the fork is 0 behind, so upstream still has this — worth sending with the `258f4c64` fix it belongs to |
| `ddd` findings feed (this commit) | A named `DddFeed` RPC entrypoint (`server/ddd/feed.ts`, exported from `workers/app.ts`). `inspectionSummary` returns the residential Summary of the latest PUBLISHED version: each included finding whose category drives the Summary, with its text, category read as a severity, location and trade, keyed `sectionId:itemId:defectId`, plus the inspection's Reference Number and address. `findingPhotos` returns up to 6 of one finding's own photos as JPEG, long side at most 1568 px. No HTTP route: only a Worker with a service binding reaches it. `server/ddd/link.ts` builds the signed link into the client's Cost Clarity Review, and returns null unless `DDD_SITE_URL` (var) and `DDD_LINK_SECRET` (secret) are both set. Both report loaders (the standalone page and the client Hub) build it after the report has loaded, for residential reports only, and the Summary view shows it as `ReportReviewLink`; the summary PDF is that page printed, so the link is in the PDF too. The public report API is untouched | NCHI-only. Data Driven Direction (`NCHILLC/data-driven-direction`, private) builds each client's Cost Clarity Review from the report Summary. The feed returns no client name or email, and its photo ownership check is the public photo route's. The feed module imports only `cloudflare:workers` eagerly, so the entry's startup graph does not grow. `tests/unit/ddd/feed.spec.ts` pins the feed to `sectionsForFilter(…, 'summary')` and the link to a test vector DDD's own tests verify |
| `report` Summary is residential-only (`456ffa9d`) | Commercial reports (`reportTier` set) have no Summary chip, no summary-PDF button, and no editor Summary entry; a `?summary=1` render of one now shows the full report instead of the Summary | Commercial PCA reports carry their own Executive Summary / Opinion of Cost front matter, so the residential-only Summary view duplicated and conflicted with it. Aaron decided on 2026-09-24 that the Summary pertains to residential inspections only |
| `deps` advisory gate, 2026-10-06 (this commit) | `sharp` 0.35.5, `@modelcontextprotocol/sdk` 1.32.1 (an override holds `agents` and `@cloudflare/codemode`, which pin 1.29.0 exactly, on the root's copy), `proxy-addr` 2.0.8, `source-map-js` 1.2.2, `smol-toml` 1.9.0. `patch-package` removed: `postinstall` runs `scripts/apply-patches.mjs`, which applies `patches/*.patch` with `git apply` | Fork-only: upstream's lockfile carries the same five advisories (checked at `d1a88a48`). `braces` (GHSA-vfj7-8cjw-p6xm) has no patched release and reached the tree only through `patch-package`, so removing that package was the only way to clear it. The wrangler patch itself is unchanged and `lint:wrangler-patch` still checks the result. Installing now needs `git` on the PATH |
| Phone ergonomics (2026-10-06 mobile review; no upstream fix for any of it) | Mobile sync pill reads the live server connection, not only `navigator.onLine`; the service worker's offline refusal is a page with retry and links to cached editors; text controls are 44px / 16px and sub-12px text is floored on a phone (rules in `app/styles/tailwind.css`); shared `Button` / `IconButton` / `TabStrip` carry `pointer-coarse:min-h-11`; hand-rolled controls that size themselves as a button (`h-8`..`h-10`, or a `<button>` with vertical padding) get the same 44px floor from one rule in that stylesheet; the photo annotator loads through `LazyPhotoAnnotator`, a dynamic import requested when the editor mounts, which took Konva and react-konva out of the editor route chunk (629 KB to 301 KB; the editor's blocking JS 585 KiB to 487 KiB gzipped); dashboard and contact detail no longer nest a second page shell; dispatch stacks its unassigned lane below `md`; auth forms declare `autocomplete` | Same reason as the `editor` row: the phone is the primary field device here. Shared-code candidates for upstream: the double page shell and `autocomplete`. Still open: text actions ("Edit", "Archive", one 18px line) need room in each page's layout, since a larger invisible hit area makes stacked ones steal each other's taps; and the string catalog is one 759 KB chunk on every page (the editor uses 17% of it, login 0.6%) because `locale-modules` compiles all messages into one module, which is upstream's choice in `vite.config.ts` |
| `tooling` contrast gate reads the stylesheet once (this commit) | `blocksFor` in `scripts/lib/contrast-css.mjs` remembers the blocks it found in the last stylesheet it was given, so `resolveVar` no longer re-parses the file on every call. One `findViolations` scan went from about 1.3 s to under 25 ms on the same machine; what the gate reports is unchanged | Upstream's `blocksFor` is identical and carries the same cost, and nothing upstream touches either contrast spec (`git log main..upstream/main -- tests/unit/tooling/small-text-contrast-gate.spec.ts tests/unit/tooling/contrast-gate-blind-spots.spec.ts` is empty at `f82bb612`). It bit here first because this fork has a fourth theme (`sun`) and the phone-ergonomics `@media` rules: the block pattern backtracks across the prelude of every nested block, so those 41 lines doubled the cost of one pass and pushed a five-scan test in `small-text-contrast-gate.spec.ts` past vitest's 5 s default on all three attempts of the `main` run for `df3b9afe`. A longer timeout would have hidden that until the next stylesheet change. Candidate for upstream |
| `pwa` offline navigation (2026-10-12 QA sweep NET-01; no upstream fix) | `react-router.config.ts` sets `routeDiscovery: { mode: "initial" }`, so the whole route manifest ships with the first document and no navigation or fetcher call waits on `GET /__manifest`. Root's `ErrorBoundary` shows "You're offline" with a Try again anchor when `isNetworkFailure` (`app/lib/network-failure.ts`) says the request never reached a server, instead of "Something went wrong". Spec: `tests/e2e/offline-navigation.spec.ts`, run by the `mobile-nav` project | Lazy discovery made an offline tap into an editor section the session had not visited a route error, and Back reloaded the same dead screen; field editing offline is the editor's documented promise. Extends the `pwa` offline row above (that fix covered the reload, not in-app navigation). Sent upstream as its own PR if the sweep's PR 1 is ever raised there |
| `services` price cents (2026-10-12 QA sweep; no upstream fix) | The create and update actions in `app/routes/settings-services.tsx` convert the dollar field with `parseDollarsToCents` (rounds) instead of `Number(price) * 100`. Spec: `app/routes/settings-services-price.test.ts` | `17.99 * 100` is `1798.9999999999998` and the API takes `z.number().int()`, so a price with cents (also `9.95`) was refused on save. `git log main..upstream/main` on `settings-services.tsx` and `money.ts` has only the busy-guard commit `793a4161`, which leaves the conversion alone, so upstream carries the same bug. Every other `* 100` in `app/` already rounds |
| `editor` notes reach the doc on idle (2026-10-12 QA sweep CORE-01; no upstream fix) | `setNotes` still echoes into `results` per keystroke, but now also schedules the doc write 600 ms after the last change, and `pagehide` / `visibilitychange: hidden` flush it; blur (`commitNotes`) writes at once. The path moved out of `collab-findings-api.ts` into `app/lib/collab/finding-notes.ts`. Dictation (`DictationButton`) and the comment typeahead pick call `setNotes`, so they ride the same timer; `insertComment` and `cloneLast` flush a pending note before they write. Spec: `app/lib/collab/finding-notes.test.tsx` | The doc write waited for the textarea's blur, so a reload, a discarded tab or a crash before blur lost the note while the header said "Synced". `git log main..upstream/main -- app/lib/collab/` is empty, so upstream has the same blur-only design. The caret-jump concern behind blur-only still holds for per-keystroke writes: the idle write commits the text the textarea already shows, so the rebuilt `results` carries an identical string. Not changed: the "Synced" indicator itself (NET-06) |
| `auth` first-run link (2026-10-12 QA sweep ONB-01; no upstream fix) | The `/login` loader in `app/routes/login.tsx`, on a profile with `hasSetupWizard`, asks `GET /api/auth/setup-status` and redirects to `/setup` when the answer is an explicit `isSetUp: false`. Any other outcome (refusal, unreachable API, malformed body) shows the login form. `/` already lands on `/login`, so one loader covers both. Spec: the ONB-01 block in `app/routes/login-saas-bounce.test.ts` | A fresh instance's `/` went to a login form with no way to `/setup`, which was findable only by already knowing the URL. `git log main..upstream/main` on `app/routes/login.tsx` and `setup.tsx` has no setup-link change (the hits are 2FA, invite links and submit latches). `/setup` already redirects to `/login` once users exist; the explicit-`false` rule keeps the two from looping. The loader's call is one more in-process API call on an unauthenticated standalone `/login`, so `lint:middleware-budget` was re-baselined (`login.tsx` fan-out 2 -> 3, total 541 -> 542); that gate runs only in CI, which is where it was caught. Not changed: ONB-02 (operator-only agent-terms note on `/setup`) |
| `wizard` network drop (2026-10-12 QA sweep NET-02; no upstream fix) | `app/routes/inspections.tsx` exports a `clientAction` that runs `guardWizardNetwork` (`app/lib/wizard-submit.ts`): a create whose fetch dies comes back as `{ ok: false, error: { code: "NETWORK" } }`, the shape the wizard already holds open on (`8632b8f7`), so the draft stays and Create is the retry; the agent and client typeaheads get an empty list; any other intent, a redirect or a non-network error is rethrown. The wizard submits nothing when `isOffline()` (`app/lib/network-failure.ts`, which `isNetworkFailure` now also uses) and skips the conflict and holiday loads and the typeahead while offline (read when the debounce fires, not when it is scheduled). Spec: `guardWizardNetwork` in `app/lib/wizard-submit.test.ts`, the offline case in `NewInspectionWizard.test.tsx` | A failed fetcher is routed by React Router to the route's error boundary, which unmounted the wizard with the inspector's draft. `git log main..upstream/main` on the wizard files has only focus-latch and overlay work. The `clientAction` is its own chunk (`splitRouteModules: "enforce"`), fetched on first use, hence the `isOffline()` pre-check. **Known ceiling:** a conflict or holiday load that fails mid-flight while `navigator.onLine` still says true (a bar of signal, no route) still unmounts the wizard. `file-size-baseline.json` raised for `inspections.tsx` (929 -> 934) and `NewInspectionWizard.tsx` (562 -> 571) |
| `editor` session expiry (2026-10-13 QA sweep NET-06; no upstream fix) | `usePresence` (`app/hooks/usePresence.ts`) has a fourth status, `"expired"`: a presence socket that closes without having opened asks `GET /api/auth/me` with the browser's own cookie, and a 401 reads as expired. A 200, an unreachable API or `isOffline()` leaves "Connecting…" / "Reconnecting…". The retries carry on, so logging in from another tab reconnects this one. `MobileSyncPill` and `FooterBar` show that status as `SignInAgainLink`, an anchor to `/login?returnTo=` this page with its `?section=` / `?item=`. The `/login` loader no longer bounces a token past its `exp` to `returnTo` (`isTokenExpired`, now exported from `app/lib/session.server.ts`). Specs: `app/hooks/usePresence.test.ts`, the expired case in `MobileSyncPill.test.tsx`, the NET-06 case in `app/routes/login-saas-bounce.test.ts` | A browser is never told the status of a refused WebSocket handshake, so once the 24-hour token ran out the editor retried under "Reconnecting…" with the edits held in IndexedDB, and the next navigation went to a bare `/login`. `git log main..upstream/main` by keyword (401, session, socket, collab) and on `app/lib/collab` and `app/hooks` has no such change. The check hangs off the presence socket, not the Yjs one: it is the status both readouts already show, and both sockets are refused by the same cookie check (`server/api/inspections/core.ts`, `collab.ts`). The API's JWT middleware lets a request with no cookie through, and `collab/ws` answers a plain GET with 426 before it checks auth, so the socket's own URL cannot be the probe. **Known ceilings:** a token invalidated by a password change but not yet past `exp` is still bounced from `/login` to `returnTo`, where the auth layout now ends the session (ONB-04 row below) and the visitor lands on a bare `/login`, `returnTo` dropped; under saas `/login` redirects to the portal and drops `returnTo`; on an origin where the browser refuses the `__Host-` cookie (plain http that is not `localhost`) the readout says expired |
| `auth` stale session ends at /login (2026-10-13 QA sweep ONB-04; no upstream fix) | The loader in `app/routes/auth-layout.tsx` ends the session (`destroyUserSession`: both cookies cleared, 302 to `/login`) when the API answers its session-context call with 401. Only 401: a 5xx or a thrown fetch still falls back to the default shell. Specs: `app/routes/auth-layout.loader.test.ts`; the end-to-end case sits in `tests/e2e/auth-password-reset.spec.ts` (a token from before a reset gets 302 to `/login`) | A token issued before a password change or reset passes `requireToken` (its `exp` is live) and is refused by the API (`pwchanged:{userId}`), but the loader swallowed that refusal as a "graceful fallback", so the page came back 200 with "Unnamed", `openinspection.dev` and no Dispatch, and a reload did the same. `git log main..upstream/main` by keyword (stale session, pwchanged, password reset) and on the auth-boundary files finds only the TOTP and invite-link fixes, neither of which touches this. **Known ceilings:** only a document load runs the layout loader, so a stale session that navigates client-side between child routes sees each child's own best-effort fallback until the next full load; `returnTo` is not carried; no `?reason=` notice on `/login` (the upstream plan floated `password-changed`, which would need a message in both catalogs) |
| `setup` operator notes collapsed (2026-10-13 QA sweep ONB-02; no upstream fix) | `app/routes/setup.tsx` renders the Cloudflare steps for the setup code (`SETUP_CODE`, Settings → Variables and Secrets, the add-a-secret link) and the agent-terms note with its `npm run agent-terms:publish` command inside one `<details>` that is closed on first paint, summary "For whoever deployed this: the setup code and agent sign-up" (`auth_setup_operator_summary`, both catalogs). The setup-code field keeps "Required (at least 6 characters)." plus `auth_setup_code_help_where`, which points at the note. `app/routes/setup.test.tsx` now asserts that arrangement (the F74 claim changed on purpose: the step is still named on the page, but not in the first view) | The finding: a brand-new admin's first screen ended with CLI language about a feature (agents) they have not met. `git log main..upstream/main` by keyword (setup, agent terms, disclosure) and on `app/routes/setup.tsx` finds only `fa7e6aac` (submit latch, reserved error space), which does not touch the notes. The summary names what is inside rather than saying "advanced", so F74's reason for the note (an operator who only runs this wizard never sees the publish step) still has an on-page answer. `textContent` still includes the closed disclosure, so the old specs' regexes would not have caught the move; the new ones read `details.hasAttribute("open")`. **Known ceilings:** an operator with no setup code needs one click to find where to add it (the hint says so, but does not carry the steps); the disclosure does not remember being opened; a cherry-pick of `fa7e6aac` will conflict in `setup.tsx` around the setup-code `hint` prop (it adds `reserveErrorSpace` just above it): keep both |
| `isn` order webhook + first fork-only migration (this commit) | `POST /webhooks/isn` verifies `X-ISN-Signature` with `ISN_WEBHOOK_SECRET`, re-reads the order over REST and keeps it in the new `isn_orders` table. Migration `0100_isn_orders.sql` is numbered 0100 on purpose. `file-size-baseline.json`: `server/index.ts` 747 -> 749 (the import and the mount; every inbound webhook mounts there) | NCHI-only (ISN is its CRM). The fork's first migration of its own: upstream already has `0001`-`0005`, so a fork `0001` would collide on the next merge. On that merge, take upstream's files and let `_journal.json` list them before `0100`; regenerate the snapshot chain with `npm run db:check` |
| `isn` order reconcile cron (this commit) | `isnOrderReconcileJob` (`server/cron/jobs/integrations.ts`, listed last in `CRON_JOBS`, standalone only) runs `server/services/isn/order-reconcile.ts` hourly; `scripts/check-cron-budget.mjs` scans that file; `tests/unit/tooling/cron-registry.spec.ts` lists the key in `ADDED_SINCE` and counts two single-mode jobs | NCHI-only. On an upstream merge that edits `CRON_JOBS`, the registry spec's `ADDED_SINCE`/mode counts or the gate's `EXTRA_READ_SCOPE`, keep this job's entries |
| `isn` order -> inspection (this commit) | Each stored ISN order becomes or updates an OI inspection (`server/services/isn/order-apply.ts`). Upstream code touched: `InspectionCoreService.createInspection` gains a third argument `opts.automations` (default on); the ISN path passes `false` so no booking confirmation goes out | NCHI-only. On an upstream merge that edits `createInspection`'s signature or its `fireAutomation('inspection.created')` line, keep the `opts` argument and the guard on that line |
| `isn` list ready check + From ISN filter (this commit) | Upstream files touched: `getDashboardBuckets` (`inspection-analytics.service.ts`) adds an always-present `isn` key to each list row from `server/services/isn/ready-check.ts`, documented on `InspectionListItemSchema`; `INSPECTION_FILTERS` gains `from_isn` (hidden in `InspectionsFilterStrip` while its count is 0); `DashboardInspectionRow` renders a warning chip. Migration `0101_isn_unmatched_inspectors.sql` adds `isn_orders.unmatched_inspectors` | NCHI-only. On an upstream merge that edits those files, keep the `isn` key, the filter id and the chip |
| `isn` card (this commit) | New `GET /api/inspections/:id/isn` (`server/api/inspections/isn-card.ts`, mounted in `server/api/inspections.ts`), resource route `resources/isn-card`, `IsnCard` rendered on the inspection page and at the top of the editor's `InspectionSettingsSheet`. `file-size-baseline.json`: `InspectionSettingsSheet.tsx` 419 -> 421, `inspector-portal.tsx` 1393 -> 1394 (an import and one card line each; the blocks the card stands in for are upstream code, hidden, not removed) | NCHI-only. On an upstream merge that edits the inspections router composition, the inspection page's card list or the settings sheet's Drawer body, keep the mount and the one card line |
| `isn` Part 2c: pull now, conflicts, publish result (this commit) | New `POST /api/integrations/isn/pull` (one reconcile batch, same `ISN_WEBHOOK_SECRET` switch as the cron) behind a "Pull ISN orders now" button in `IsnPanel`; new `POST /api/inspections/:id/isn/report-link` (the ISN step of publish alone) behind "Send to ISN again" on the publish receipt, which now shows `isnSync`; the list row's `isn` ready check gains `canceledInIsn`, shown as "Cancelled in ISN, kept" when OI kept the inspection. Upstream files touched: `integrations.ts`, `settings-advanced.tsx` (a `pull-isn` intent), `PublishModal.tsx`, `inspection-edit.tsx` and its `action.server.ts` (`isnSync` on the publish result; the retry intent in `action-isn.server.ts`, its state in `useIsnSync.ts`). `file-size-baseline.json`: `inspection-edit.tsx` 2308 -> 2311, `action.server.ts` 511 -> 515 (imports and one call each). `lint:middleware-budget` (CI-only) re-baselined for the two new in-process calls: `settings-advanced.tsx` fan-out 10 -> 11, `action-isn.server.ts` new at 1, total 543 -> 545 | NCHI-only. On an upstream merge that edits those files, keep the route, the two intents and the receipt banner. Not built: ISN service changes after create still do not reach the inspection's lines; the ready check's service warning is the only signal |
| `isn` webhook `?key=` for unsigned webhooks (this commit; `git log main..upstream/main -i --grep=isn` has no webhook work) | `server/api/isn-webhook.ts` accepts a delivery with no `X-ISN-Signature` when the URL's `?key=` equals `ISN_WEBHOOK_SECRET` (constant time); a sent signature must still verify. Spec cases in `tests/unit/integrations/isn-webhook.spec.ts` | NCHI's ISN office has no signing option on its Webhooks screen and no REST `/webhooks` ("missing or invalid action specified", 2026-10-26), though ISN's docs describe both. The body only names an order that OI re-fetches with its own keys, so a URL key is enough. Fork-only file |
| `isn` deleted orders count as cancelled (2026-10-26; `git log main..upstream/main -i --grep=delet` and on `server/services/isn/` has no such fix) | `orderFacts` sets `canceled` when `deleteddatetime` is set as well as when `canceled` is `yes`, so apply, reconcile and the ready check all skip or cancel a deleted order. Spec case in `isn-order-apply.spec.ts` | ISN leaves `canceled: no` on a deleted order (it sets `deleteddatetime` and `show: no`). The first pull imported a booking-funnel test draft, order 134, deleted in ISN on 2026-10-08. Fork-only file |
| `isn` order price from ISN (2026-10-26, owner request; fork-only ISN code, nothing upstream) | `orderFacts` reads `totalfee` and `fees`; every apply sets `inspections.price` to the total and `priceLinesFromIsn` (`order-apply.ts`) writes `price_override_cents` on the active lines: each fee on the line whose service shares its first word, the remainder on the dearest line, so the lines sum to ISN's total. Spec cases in `isn-order-apply.spec.ts` | ISN bills each order (Essential was $425 to $605), so OI's fixed catalog price was wrong on every ISN inspection. ISN wins on price as it does on time. **Known ceiling:** first-word matching; two services sharing a first word would need a mapping |
| `styles` (2026-10-26) | `.ih-input` outlines with `--ih-border-strong-color`; light and dark strong set to `#64748b` (light was `#cbd5e1`, dark `#475569`) so every control edge clears WCAG 1.4.11's 3:1 | Upstream draws inputs with `--ih-border-color` (field 2.36:1, light 1.23:1). Upstream `4383b685` moves these tokens to `packages/field-ui/src/theme.css` with unchanged values: when taking it, re-apply these three lines there |

## Rules

- One line per decision, citing a commit or range (`git log a..b`), never a
  migration number or a PR number from the other repository without its owner
  (`InspectorHub/OpenInspection#324`).
- Record skips as explicitly as takes. "We looked and said no" and "we never
  looked" are the same silence otherwise.
- Update the snapshot when you fetch, not when you remember.
| `agreement` merge fields filled at send, placeholders block the send (2026-10-13 QA sweep DELIV-01, Blocker; no upstream fix) | `AgreementService.findOrCreate` (`server/services/agreement/envelope-legacy.ts`) runs the template through `fillAgreementTokens` (`server/lib/agreement-tokens.ts`) before it freezes `content_snapshot`: `[INSPECTOR_NAME]` (assigned inspector, else the company's legal or company name), `[CUSTOMER_NAME]`, `[PROPERTY_ADDRESS]`, `[INSPECTION_DATE]` (long civil day) and `$[AMOUNT]` (`getEffectivePriceCents`: invoice, then service lines, then `inspections.price`); `[CLIENT_SIGNATURE_BLOCK]` and `[SIGN_DATE]` become "(signature captured below)" and "(recorded at signing)", values HTML-escaped. If any other bracketed ALL-CAPS token remains, or the starter's "Review before sending to real customers" notice is still in the text, it throws 422 naming them and creates no envelope. `SendAgreementModal` takes `serverError` and shows it inside the dialog (the page-level line it replaces sat under the scrim, so Send looked dead). Specs: `tests/unit/agreements/agreement-send-tokens.spec.ts`, `app/components/agreements/SendAgreementModal.test.tsx` | The finding: a fresh company's only template could be sent and signed with every merge field still in brackets and the admin caveat in the permanent record. `git log main..upstream/main` by keyword (placeholder, merge field, starter agreement, agreement) and on the fixture file finds nothing; the upstream plan lists it under its PR 5 but upstream has not landed it. The starter text is unchanged, so an untouched starter is refused (notice and the liability clause both stay) until the company edits it in Settings; that is the intended state of a legal document, not a gap. **Known ceilings:** the match is `[A-Z][A-Z0-9_]{2,}`-style brackets only, so a custom template with lowercase or `{{x}}` fields is sent as written; the check runs only when an envelope is created (reusing a live envelope does not re-check); an inspection with no price blocks on `[AMOUNT]` rather than printing $0.00; the signing page itself still shows what the snapshot holds, so envelopes sent before this change keep their placeholders |
| `ContactModal` closes after a save (2026-10-13 QA sweep FORM-01, Major; no upstream fix) | `app/components/contacts/ContactModal.tsx` closes on the fetcher's busy to idle transition with `ok:true`, in an effect, instead of reading `fetcherOk` inside `onSubmit`. Spec: `ContactModal.test.tsx` (proven red without the change) | The finding: the 200 created the contact but the dialog sat open with the form refilled. The old handler read the PREVIOUS result at click time, so it could only close on a second save. `upstream/main` (`435b24ec`) still has that line: its `793a4161` added the busy latch around it and left it. The transition (not the value) is the trigger because the modal stays mounted and an earlier `ok:true` is still in `fetcher.data`. No "Contact added" toast: the new row in the list is the confirmation, and a toast is a new string in both locales for this fork alone |
| `/templates` create dialog stays open until the action answers (2026-10-13 QA sweep FORM-06, Major; no upstream fix) | `handleCreate` in `app/routes/templates.tsx` no longer closes the dialog and clears the name on click; success navigates to the editor, failure renders `error` in the dialog (it was already wired, to a dialog that had been closed). `CreateTemplateModal` gets `maxLength={100}`, the API's limit. Spec: `app/routes/templates.test.tsx` | The finding: a ~330-character name did nothing visible, because the API refused it after the dialog had closed. Checked `upstream/main` for the route and the modal: same close-on-click. **Known ceilings:** no character counter (a new string in both locales), so a typed name just stops at 100; the server's 400 for an over-long name is the generic "could not create" text if it ever gets past `maxLength` (the zod message is not read) |
| Public links choose `http` only for exact loopback hosts (2026-10-13 QA sweep DELIV-02, Major; no upstream fix) | `scheme()` in `server/lib/public-urls.ts` matched `host.startsWith('localhost')`, so a real domain that merely begins with `localhost` or `127.0.0.1` got `http://` on token-bearing agreement, invoice and checkout links. It now compares the hostname exactly (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`). Spec: `tests/unit/reports/public-urls.spec.ts` (proven red without the change) | The sweep saw `http://127.0.0.1:8791/...` in the emails and the `/v/` QR. That was the local dev host, which is loopback on purpose, and the QR base is `APP_BASE_URL`, which the sweep had set to an `http` address; neither is a production defect. **Known ceiling:** `getBookingHost` still returns a bare host, so the scheme is guessed from the hostname, not read from the request or `APP_BASE_URL`; an operator who sets `APP_BASE_URL` to `http://` on a non-loopback host still gets `https` links from these builders. Threading the scheme through the ~20 callers was not worth it for a loopback-only discrepancy. |
| Copy pass over the English and es-419 catalogs (2026-10-13 QA sweep COPY-01 to COPY-15; no upstream fix, `upstream/main` `435b24ec` only adds feature copy) | Catalog values only, keys unchanged. COPY-01 "workspace" becomes "company" (login heading, validation, nav, settings, notices; the es-419 equivalents become "empresa"); COPY-02 the login network error no longer asks whether the API server is running; COPY-03 "Cross-tenant view" becomes "Every inspector in one view"; COPY-04 the cited button pairs go to sentence case (Create account, Log in, Sign agreement, Save company, Invite member, plus two email CTA defaults); COPY-05 curly apostrophes become straight (the 138 to 23 majority); COPY-06 `...` becomes `…` except the `https://g.page/r/...` placeholder; COPY-07 the seven generic errors say what failed and what to do; COPY-08 tenant, D1, SaaS, payload and backend leave user-facing strings; COPY-09 "slug" becomes "link ID" or "link name"; COPY-10 "Recommendations" becomes "Repair Items" in the agent custom-category note; COPY-11 "Order" becomes "Inspection"; COPY-12 "Customers" becomes "Clients"; COPY-13 "Envelope ID" becomes "Document ID" (catalog and the hard-coded line in `server/api/agreements-render.ts`); COPY-14 "Accept invite" and "Accept invitation" settle on "Accept invitation" | **Known ceilings:** COPY-04 fixes the pairs the finding names, not every Title Case label in the 30 files; a lint rule would be the durable fix and is not written. COPY-15 needed no change: ONB-02 already moved the Cloudflare steps into the collapsed "For whoever deployed this" note. The generic route error boundary in `app/root.tsx` is hard-coded "Something went wrong" and untouched. Message keys keep their old names (`settings_workspace_*`, `agent_report_actions_workspace_*`, `auth_validation_workspace_name_required`, `metrics_kpi_aov`) to keep the diff to values; the es-419 values were edited by the same rule, not re-reviewed by a Spanish speaker |
| Shell notices bell no longer takes the portal to the offline boundary (2026-10-12 NET-02 observation; no upstream fix) | `app/routes/resources/staff-notices.tsx` gets a `clientLoader` that returns the empty list when `serverLoader()` fails with `isNetworkFailure`; any other error still throws. Spec: `staff-notices.test.ts` | The bell loads through `fetcher.load` on every page. The server loader's try/catch cannot see its own `.data` request failing, so under emulated offline the rejection reached the root boundary and replaced the whole portal with "You're offline". **Known ceiling:** not re-seen in the pane (unit spec only); the bell shows no notices while offline rather than a cached list. |
| Dashboard rows name their client (2026-10-26; `git log main..upstream/main` on the analytics service and row has no client fix, upstream's `getDashboardBuckets` sets no `clientName` either) | `getDashboardBuckets` adds the `client` role to the existing `inspection_people` agent query and sets `clientName` on every row (null when none). `file-size-baseline.json`: `inspection-analytics.service.ts` 756 -> 759 (the map, the row field and its type line, which is load-bearing). Spec case in `inspection-dashboard-agent-people.spec.ts` | Every dashboard row read "No client": the client columns on `inspections` were dropped for `inspection_people`, and the row had no other source. Seen on the first ISN imports. Offer upstream |
| Device-local choice of when queued photos upload (2026-10-17, owner request; `upstream/main` has no equivalent, keyword and file checks on the drain found nothing) | `app/lib/collab/photo-sync-mode.ts` holds `oi.uploads.syncMode` (`auto` default, `prompt`, `wifi`) and the pure `gateDrain`; `useMediaDrain` gates every automatic trigger through it, with a once-per-reconnect toast and a `oi:media-sync-now` event that overrides the mode; `MobileSyncPill` becomes a tap-to-sync button while photos are held; the Photo uploads block of the inspection settings sheet gets the selector; `enqueueMedia` asks for `navigator.storage.persist()`. Specs: `app/hooks/useMediaDrain.test.tsx`, `MobileSyncPill.held.test.tsx` | The owner's concern: searching for signal drains the phone and interrupts report writing, while the report needs the photos. Photos were already safe on the device first. **Stored per device, not per account**, like the original-quality setting: the drain must read it with no network, and it follows the phone's battery and signal; a server-side per-user column was offered and declined. **Known ceilings:** `navigator.connection.type` is missing on iOS Safari, so wi-fi mode there asks like prompt mode; known cellular in wi-fi mode holds silently (pill still shows tap-to-sync); queued photos upload only when their inspection is reopened; not seen in a browser pane (unit specs only). Also corrects the stale offline-photo line in `docs/reference/architecture-notes.md` |
| In-app camera frames are turned upright by the phone's tilt (2026-10-23, owner report of sideways photos; `git log main..upstream/main` on `preprocessImage.ts` and keywords orient/rotat/sideways/exif finds nothing) | `FieldCamera.shoot` rotates the canvas by `captureQuarterTurns(ax, ay, screen.orientation.angle)` (`cameraTurns.ts`) from the latest `devicemotion` gravity. Spec: `cameraTurns.test.ts` | The finding: 24 commercial photos were all 1440x2560 with no EXIF (a video-frame size; the Pixel's own files are 3072x4080 with orientation), 21 sideways. A getUserMedia frame follows the screen, so a rotation-locked screen with the phone held landscape yields a sideways frame the upload bake cannot fix. **Known ceilings:** the sign convention (top edge left = x > 0 = one CCW turn) matches how the 21 were hand-corrected but is not yet seen on a device; iOS shoots its first frame unturned while the motion prompt is answered; a phone held flat uses the screen as-is; photos already stored sideways are not repaired |
| ISN as the CRM: `EXTERNAL_CRM=isn` hides OI's CRM screens (2026-10-23, owner decision C1-C3; `git log main..upstream/main -i --grep=crm` found nothing) | New `DeploymentProfile.externalCrm` shipped on the session payload; one `CRM_PATHS`/`isCrmPath()` list read by sidebar, drawer, settings and library hubs, command palette and the auth-layout guard (`/feature-disabled`); inspection page drops signing, SMS consent, communication and invoice blocks; Services drops pay rules and deposits; Integrations drops Stripe, QBO, Google Calendar; client Hub drops Agreement/Payment/Messages; public booking 404s by path list. Staff APIs stay open. | NCHI runs booking, contacts, invoicing, agreements and messaging in ISN; showing OI's copies invites double entry. Fork-only because the vendor is NCHI's choice. |
| Phone item screen, canvas S05 + X3 (2026-10-26, phone UI slice 6; `git log main..upstream/main -- app/components/editor` is upstream's `field-ui` package move, not taken, see the `editor` scope row) | Below `md` only: photos first, item heading kept for screen readers only (the app bar names the item), tabs Defects · Info · Limits · Notes with Notes holding the existing notes field (`PhoneItemParts.tsx`, `extraTab` on `CannedCommentTabs`), Location shows "Needed to publish" while empty, and a bar above the rating strip counts defects the gate will block. The bar uses the gate's own rule (`missingLocationCount` mirrors `computePublishReadinessFromState`: tenant/inspection policy or a gate flag), NOT a Safety-only rule as the canvas words it | Built on the pre-package editor like slices 1-5. A severity-specific location rule would be a new server rule, not a layout change: owner's call |
| Phone defect search, canvas S06 (2026-10-26, phone UI slice 7; `git log main..upstream/main -- app/components/editor` is still upstream's `field-ui` package move, not taken) | Below `md` only: the Defects tab's search box is a button that opens `PhoneDefectSearch.tsx` full screen (`phoneItemLabel` on `CannedCommentTabs`). It drives ItemEditor's existing state: the query, the template defects (Add / Added toggles them), the library hits (Add seeds the write form, as on desktop), and the custom-defect draft. Severity in the write form is the existing category list (Safety / Recommendation / Maintenance + tenant categories), not the canvas's Minor / Moderate / Safety; the chip on a template row shows this inspection's override. Groups read "For this item" and "From your library" (the library search is tenant-wide, so "From other items" would be untrue). "Save to my library" stays off by default, as on desktop. Trade is not in the phone write form (optional; custom defects are not gated) | Built on the pre-package editor like slices 1-6 |
| Phone inspection details, canvas S03 (2026-10-26, phone UI slice 8; `git log main..upstream/main -- app/components/editor` is still upstream's `field-ui` package move, not taken) | Below `md` only: `PhoneInspectionDetails.tsx` puts People (client and agents from `inspection_people`, Call `tel:` / Text `sms:` when a phone is recorded) and Access (ISN gate code behind Show code, occupied / utilities) above the shared property form, which takes `phone` for three fields to a row, 48px inputs and select fields as a radiogroup. The app bar names the screen, and Next leaves it. Access renders only for ISN inspections, the one place OI keeps a gate code. Canvas items NOT built: Temp °F and Weather (no column or report field exists, and weather is not a publish gate, so the "Needed to publish" pill has no rule behind it), Pets (ISN card has no such field), the lockbox location | Built on the pre-package editor like slices 1-7. Weather and temperature need a schema field and a report line: owner's call |
| Publish gate reads the composite result key (2026-10-27; upstream `main` has the same bare-id read, no fix to take) | `computePublishReadinessFromState` in `server/services/inspection/shared.ts` reads each item through `readItemEntry` (`_default:<section>:<item>` first, bare id second) instead of `results[item.id]` | The collab flush writes the composite key, so the bare read found no defect state on live data and the gate always passed, even with a required location missing. Upstream candidate. |
| Phone camera, canvas S07 (2026-10-27, phone UI slice 10; `git log main..upstream/main -- app/components/editor` is still upstream's `field-ui` package move, not taken) | `FieldCamera.tsx` gains the canvas chrome: an Item / Defect target toggle (the Defect segment, red, exists only when the session was opened from a defect chip; the chips now pass the defect's title through `openPickerForDefect`), a newest-first strip of this session's shots (a red dot marks a defect shot, tapping one opens markup), an "n photos this session" pill, a Mark up button, a flash toggle that renders only where the video track reports `torch`, and the hint "Each tap of the shutter saves one photo." The hook's `handleAnnotateNewest` became `handleAnnotateShot`, which marks up any shot by counting from the end of the item's or the armed defect's `photos[]`; `setCameraTarget` re-aims the pending target without forgetting the armed defect. The chrome applies at every width (the camera is one fixed full-screen overlay); the canvas's white shutter-flash overlay and its Roof / item-name header are NOT built (no feedback beyond the existing haptic; the section and item names are not passed in) | Built on the pre-package editor like slices 1-9. Item and defect are the only targets the data model has; the canvas's markup screen is S08 (slice 11), so a tapped shot opens the existing `PhotoAnnotator` / defect studio over the camera exactly as the old edit badge did. |
| Phone markup and photo review, canvas S08 and S09 (2026-10-27, phone UI slice 11; `git log main..upstream/main -- app/components/editor` is still upstream's `field-ui` package move, not taken) | **S08:** below `md` the markup header reads "Photo 2 · Defect" (or Item) over the defect or item name with a text Save button, the tools are a five-column labelled grid (a new Box tool joins Circle, Arrow, Draw and Label), Red / Yellow / White colour radios and an Undo sit under them, and the hint reads "Tap the photo to add a <tool>" (Arrow and Draw keep their drag hints). `Annotation` gains an optional `color` and a `rect` kind; marks saved before it read as red. The top bar moved out of `PhotoAnnotator.tsx` into `AnnotatorTopBar.tsx`; the caption field is hidden on the phone (no caller saves it). **S09:** `PhonePhotoReview.tsx`, opened by tapping a strip thumbnail below `md` when the editor supplies `onPhotoAction`: a three-column grid with a Cover label, the cover note, and Set as cover / Move / Edit / Delete on the selected photo plus a "Move photo to" sheet. Delete and Set as cover call the viewer's own handler (so Delete keeps its "Photo deleted" Undo toast); Move calls the strip's bulk move and toasts "Moved to <target>"; Edit opens the old viewer (crop, mark up, rotate, caption, revert) | The canvas's Defect labels and defect move targets are NOT built: a defect's photos live in the defect's own array and nothing moves a photo between an item and a defect. Move has no Undo (a move back would have to guess the photo's index in the target item); Set as cover keeps the existing crop-then-set flow, so it has no "is now the cover" toast. Edit is an addition to the canvas so the viewer's crop and mark-up stay reachable. The defect name in the markup header is only known for a camera-armed defect; opening a defect photo from its chip shows the eyebrow alone. |
| Phone offline banner, canvas X1 (2026-10-27, phone UI slice 12; `git log main..upstream/main -- app/components/editor` is still upstream's `field-ui` package move, not taken) | `MobileOfflineBanner.tsx`, mounted by `MobileDrillShell` under the app bar, phone only: "No connection" with "Ratings and n photos are saved on this phone. They upload when you reconnect." and Retry; "Reconnecting…" with "Keep working. Nothing is lost." while the phone has a network but the socket is down; a 4 s "All synced" once a cut-off ends and the local queue is empty. It reads the same two facts as the sync pill, now shared in `useSyncSignals.ts` (`navigator.onLine`, `listPendingMedia`) plus the live-socket status. `PendingPhotoDot.tsx`: a yellow dot (`ih-watch`) on each strip thumbnail and each review-grid tile whose `pendingId` is set, with a legend line under the strip and the grid. The pill reads "Offline · n waiting" in the watch (amber) tone instead of the bad (red) one, as drawn | Retry has no reconnect to call (the browser reconnects the network and the socket): it re-reads `navigator.onLine` and, when the phone is back, fires `SYNC_NOW_EVENT`, the same flush the held-photos pill uses; while truly offline it only re-checks. The canvas's "Uploading n of m photos" banner is not built (the pill already counts the queue); the "Keep working" line sits on the reconnecting banner, as drawn, not on the offline one. The yellow dot marks `pendingId` photos only (an item/defect photo captured offline); the canvas's per-row dot on the checklist is not built because the checklist row carries no per-item pending count. |
