# Upstream contribution ledger

Every fork-only commit, sorted by what should happen to it now that this fork
contributes to `InspectorHub/OpenInspection` instead of diverging from it
(decided 2026-09-13; pitch posted in upstream Discussion #233).

Sorted 2026-09-13 against `upstream/main` `feb4a344` (v2.1.0 plus PRs #355–#356; v2.2.0 not yet released). "Upstream lacks
it" was established from upstream's history on the same files since the last
merge (`ac02ba3e`) plus a read of the specific code — **not** by running
upstream. Re-check each one against a fresh `git fetch upstream` when it is
actually sent, per the rule in `CLAUDE.md`.

Commits marked † are only on `fix/wizard-dashboard-offline` (not on `main`,
never pushed).

## 1. Report privately first

| Commit | What |
|---|---|
| `bda22908` † | Auth hardening, security-relevant. Goes to upstream as a **GitHub Security Advisory**, not a PR or discussion. Do not push `fix/wizard-dashboard-offline` to this public repo until the advisory is filed and upstream has shipped a fix, because the commit message and diff describe the gap. |

## 2. Already upstream or superseded: do not send

| Commit | What | Why not |
|---|---|---|
| `71fa3e26` † | Published report stays shut until payment and agreement clear | Upstream fixed it independently: `f2ad2570`, `a1541b7f`. When those reach this `main` (upstream piece 2) and conflict in `report-access.ts` / `public-report.ts`, **take upstream's version** (owner, 2026-09-14): it also gates the repair builder. Upstream's photo door still re-resolves the gate once per photo, so apply the once-per-view fix to its code, not ours |
| `af4eef00` | OpenAPI snapshot lazy-loaded | Upstream's copy kept at the 09-07 merge (Discussion #325) |
| `5cf05963` | Bundle gate measures the eager import closure | Replaced by upstream's `wrangler check startup` gate |
| (was `8097e857`, dropped in the 2026-09-14 rebase) | Embedded booking form carries Turnstile | Upstream `1477a75f` arrived whole with the v2.0.0 merge, together with the server change that skips an empty origin allowlist, so the hand port and its unsent-`?embed=1` workaround were both superseded |
| `5743faf4` | sharp 0.35.4 | Upstream already requires `>=0.35.4` |

## 3. Bug fixes upstream lacks: send as small PRs, each with its test

Independent of the phone pitch, so these can go before the maintainer answers.
Grouped into one PR per line.

| PR | Commits | What |
|---|---|---|
| Scheduling guard | `8994e0cd` †, part of `e3b47704` † | `PATCH /inspections/:id` bypassed the closed-day/overlap refusal the dispatch board enforces |
| Report versions | `aee86da6` †, part of `e3b47704` † | Version lookups scoped by inspection, not report; arbitrary tie on multi-report orders |
| Publish reads fresh doc | `27f9f9de` † as amended by `140720a3` † | Publish must flush the collab Durable Object before snapshotting. Send the flush only; the readiness refusal was withdrawn |
| Billing/team/metrics | `c1aec37e` † (consider three PRs) | Void invoice accepts payment; last owner removable; metrics count cancelled inspections |
| Dashboard overdue | `7ad1ef0c` †, `5b6cfed4` † | `requested`/`confirmed` past date lands in no bucket |
| Wizard | `8632b8f7` †, `eb645da9` † | Refused create closes the wizard silently; device day instead of workspace day; email fields ungated |
| Intake review | `3f4c4d67` †, `900437c5` † | Review promises rows and a conflict policy the commit won't honour |
| XLSX shared strings | `006f2eab` | Re-saved XLSX exports read as empty: upstream reads inline strings (`6c3cfd08`) but not `sharedStrings.xml` |
| Intake severity | `70d92692`, `781c3be4`, `740aac9f` | Imported comments and graded severity lost; defects filed by category name instead of position. Upstream reworked the adapters since (`7a423e0f`, `d124e433`), so expect a rebase |
| Logo upload | `0f63f137` | Branding service is constructed with no R2 bucket, so the logo upload has nowhere to write |
| Prefs revalidation | `0443b527` | Tenant prefs revalidated on every editor interaction |
| Hydration | `4ac38e91` † | `useBreakpoint` reads `matchMedia` on first client render; hydration mismatch rebuilds the editor on every phone load |
| Offline PWA | `ca90a94d` †, `f54f17ee` †, `a30277c7` | Offline reload hits the error boundary; service-worker API branch never fires |
| Offline defect photo | `85669e05`, `0a67710d`, `14ab84f9` | A defect photo taken offline is lost instead of queued |
| Cold-start CPU | `cf7a4999`, `6bb5dbb2` | Signing workflow and MCP/OAuth graph evaluated on every cold start. Fits upstream's stated free-plan goal; bring before/after numbers |
| Editor small fixes | `2f4a81e4`, `bad3381d`, `207964b3`, `58c24855`, `56851e5f`, `ee2e5a02`, `72f5cd94` | Photo picker target, capture session target, unsaved-changes blocker with no exit on phone, idle tile reads rated, flag not shown plus layout collisions, shutter taps eaten by double-tap, sun theme tiers identical |
| Comment preview markup | part of `a3506703` | Rich-text comment bodies render literal `<p>` tags in editor rows. Split out from the AI-panel and font changes |

## 4. Phone field capture: wait for the maintainer's answer in #233

Send only in the shape and order upstream agrees to. Listed roughly in
dependency order.

| Area | Commits |
|---|---|
| Prerequisite refactors | `a6845cad`, `017c7d79` |
| Drill-down stack (URL-addressed, hardware back, survives reload) | `0040ad21`, `79d1cd47` (drilldown half), back-from-section-list half of `0d197208` |
| Navigation aids | `c2c4e898` report search, `513578e7` Next control |
| Camera, overlays, capture | `0de880c8`, `1b1cb2c2`, `ba0b7efa` (without the Measure removal) |
| Defect photos and annotation | `d295128c`, `5b18bdb6`, `7b0a8a5a` damage stamps |
| Phone ergonomics | `3f668ed4` rating strip, `f90d0670` 44px floor, `fc1b5be4` severity grid, font-size half of `a3506703` |
| Input shortcuts | `65bf789d` dictation, `c7c77d82` location chips |
| Per-defect severity | `d2e2ee84` (the control, not the removals), `d74b35cf`, `3df15d14` (projection fix), `237a70dc`, `92d479bc` |
| Rating display | `d243379a`, `db8df8c2` (F beside the rating; IN/NI/NP as a preset, not the default) |
| Not-inspected reasons | `e33ad4b2`. Upstream has a `notInspectedReason` of its own, so reconcile before proposing |
| Template authoring | `fccf106d` progressive-disclosure comment editor, `79ead922` phone preview |

## 5. NCHI-only: stays in this fork

| Commit | What |
|---|---|
| `2172d817`, `0cce5b1a` | Agent portal UI removed (referral tracking lives in ISN) |
| AI panel half of `a3506703` | "Improve wording" unmounted |
| Default half of `3df15d14` / `0d197208` | IN/NI/NP as the shipped default |
| Removal half of `d2e2ee84` | Trade, deadline, timeframe selects removed. Upstream *requires* trade at publish, so propose it upstream as optional if at all |
| Measure half of `ba0b7efa` | Measure tool removed |
| `87e3446f` | Transitive advisory pins, and `allowScripts` kept, both for this machine's npm |

## 6. Fork infrastructure: never upstream

CI and gates: `28911d9b`, `bd5568b8`, `92b4bdae`, `07fbe2c3`, `80042fcf`,
`4e6f5e92`, CI half of `79d1cd47`, `4b2190cb`, `7f3be3e6`, `ce03cde3` †.
Docs: `6c40fd64`, `7a32c9f5`, `bbdda79e`, `d39ea9b3`, `96497f88`, `886424a3`,
`fdaf91d7` †, `35391e0f`. Tooling and tests: `bd1e8478` preflight,
`b9577317` CRLF escape hatch (moot under upstream's LF policy), `8098337a`,
`1a6e30b5`.
