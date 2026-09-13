# Merge brief: upstream piece 2 (PR #353)

Instructions for the one-shot cloud routine scheduled 2026-09-14. Delete this
file in the PR that carries the merge; it has no use afterwards.

Aaron, the owner, is a home inspector, not a developer. Write the PR
description for him: what changed, what was kept, and anything he should try
on his phone.

## Hard limits

Do not merge the PR, push to `main`, deploy, run `wrangler` against any remote
resource, touch any database, skip git hooks (`--no-verify`), or post anything
to the upstream repository (issues, PRs, discussions, comments).

## Context

`NCHILLC/OpenInspection` (public) is a copy of `InspectorHub/OpenInspection`
customized for phone field use. It is catching up to upstream in three pieces,
cut at upstream merge commits. Piece 1 (v2.0.0 through upstream PR #352) is on
`main` and deployed. **Your job is piece 2 only**: upstream commit `c9ba8112`,
"Merge pull request #353 from important-new/main", 46 new commits, no
migration changes. Do not merge anything past `c9ba8112`.

Read first:

1. `CLAUDE.md`: project rules, commit style, quality gates.
2. `docs/develop/fork-log.md`: a decision log. The 2026-09-13 piece-1 entry is
   the template for yours. The "Fork deviations" table says what the fork
   changed on purpose.
3. `docs/develop/upstream-contribution-ledger.md`: sections 4 and 5 list the
   phone-UI and NCHI-only changes that must survive the merge.

## Setup

```bash
git remote add upstream https://github.com/InspectorHub/OpenInspection.git
git fetch upstream
git switch -c merge/upstream-piece-2 origin/main
npm ci
git merge --no-ff --no-commit c9ba8112
```

## Expected conflicts and how to resolve them

Default rule: take upstream's change, but never lose the fork's phone-capture
behaviour or its deliberate deviations. When both sides fixed different things
in the same file, keep both.

- **Agent portal UI**, a modify/delete conflict on `app/components/agent/AgentTermsConsent.tsx`,
  `app/routes/agent-layout.tsx`, `app/routes/agent/{agent-repair-items-redirect,login,login.test,settings-profile,signup,signup.test}.tsx`
  and `tests/e2e/agent-unified-link.spec.ts`. The fork deleted the agent
  portal UI on purpose (`2172d817`: referral tracking lives in ISN, and the
  route tree was over the Worker's startup budget). **Keep them deleted**
  (`git rm`). Keep upstream's server/API/service changes for agents; only the
  UI stays gone. Then check that nothing new in this range re-registers agent
  portal pages in `app/routes.ts`, or imports a deleted file. If upstream
  *added* new agent-portal UI files, remove those too and say so in the fork log.
- **Phone editor and annotator**: `app/components/editor-shared/RatingSegment.tsx`,
  `app/components/editor/{CannedCommentTabs,NotesFieldHeader,PublishModal}.tsx`,
  `app/components/media-studio/{AnnotationToolbar,PhotoAnnotator}.tsx`. Combine
  both sides. The fork's versions carry its phone work: 44px touch targets and
  larger text, per-defect severity tiles in place of trade/deadline/timeframe,
  the dictation button in the Notes header, damage stamps, Measure tool
  removed, the idle "Inspected" tile styling, and the AI "Improve wording"
  panel unmounted. Take upstream's fixes and new behaviour around them. Read
  `git log -p origin/main -- <file>` for the fork's intent and
  `git log -p <merge-base>..c9ba8112 -- <file>` for upstream's before deciding.
- `app/lib/forms/auth.schema.ts`: combine both sides; check the fork change's
  reason with `git log origin/main -- <file>`.
- `messages/en/editor-3.json` and `messages/es-419/editor-3.json`: keep every
  key from both sides; no duplicate keys; valid JSON.
- `server/lib/mcp/oauth-provider.ts`: keep both. The fork's lazy MCP/OAuth
  loading (`6bb5dbb2`, with `server/lib/mcp/oauth-paths.ts`) keeps the cold
  start small. Upstream's change (S256-only PKCE) is a security fix and must
  land.
- `server/lib/migration-intake/formats/xlsx-sheet.ts`: keep both. The fork
  reads shared-string cells (`sharedStrings.xml`, `006f2eab`); upstream added
  inline-string cells (`6c3cfd08`). A re-saved XLSX needs both.
- `scripts/file-size-baseline.json`: take upstream's, then
  `node scripts/check-file-size.mjs --update` (a reviewed decision; the fork's
  large files have no cap in upstream's copy). Say in the fork log whether any
  file grew *because of the merge*.
- `scripts/middleware-budget-baseline.json`: resolve so it reflects the merged
  tree, and explain any changed number in the fork log.
- `package-lock.json`, if it conflicts: take upstream's, then `npm install`, and
  confirm every `resolved` URL is on `registry.npmjs.org`.
- `scripts/unread-fields-baseline.json`: if the unread-field gate flags a
  field whose only reader was deleted agent-portal UI, add a `wire-shape` entry
  with that reason, **without re-sorting the file**. Insert only; upstream edits
  this file too. A field the fork added and nothing reads should be deleted
  instead.

If a conflict does not fit these rules, prefer the smallest resolution that
keeps both intents, and flag it in the PR description under "Please check".

## Verify

Run, and fix what they report:

- `npm run lint:gates-full`
- `npm run type-check:api`, then `npm run type-check:app`. These need a lot of
  RAM. If one is killed for memory, say so in the PR and rely on CI rather than
  guessing.
- `npm run test:unit` and `npm run test:web`, if time allows. CI runs the full
  suite on the PR either way.

Commit hooks will run their own checks. Let them; fix causes, never bypass.

## Deliver

1. Add a "Merge — <date>, upstream `8ba7467b..c9ba8112` (46 commits, PR #353)"
   entry to `docs/develop/fork-log.md`, above the piece-1 entry, in the same
   style: what was taken, each conflict and how it was resolved, anything
   deliberately dropped.
2. Delete this brief (`docs/develop/merge-brief-piece-2.md`).
3. Commit the merge with a message like the piece-1 merge (`git show -s 81abd59a`),
   ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
4. `git push -u origin merge/upstream-piece-2`, then open a PR against `main`
   on `NCHILLC/OpenInspection`. The description, in plain language:
   - what upstream shipped in this piece
   - the conflicts and how each was resolved
   - "Please check" items, including what to try on a phone
   - check results
   - end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
5. Stop. Do not merge.
