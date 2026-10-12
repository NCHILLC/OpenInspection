# Test layout

The location → suite → config table and the `docs-shots` note, moved verbatim out of `CLAUDE.md` / `AGENTS.md`. The decision list and rules are in [`docs/develop/testing.md`](../develop/testing.md) §1.

Directory = suite; a spec's location alone decides which config runs it
(gated by `npm run lint:tests`):

| Location | Suite | Config |
|---|---|---|
| `app/**/*.test.{ts,tsx}` (co-located) | `test:web` (CI) | `vitest.config.ts` |
| `tests/unit/<domain>/` | `test:unit` (CI) | `vitest.api.config.ts` |
| `tests/workers/` | `test:workers` (CI) | `vitest.workers.config.ts` |
| `tests/contract/<party>/*.contract.spec.ts` | `test:contract` (CI) | `vitest.contract.config.ts` |
| `tests/contract/<party>/*.live.spec.ts` | `test:contract:live` (pre-push when `server/services/qbo/` changed; needs a connected sandbox) | `vitest.contract.live.config.ts` |
| `tests/e2e/` | `test:e2e` · `test:e2e:seeded` (+ integration/remote/docs-shots modes) | `playwright.config.ts` (local, seeds D1) / `.seeded` / `.integration` / `.remote`. `npm run lint:e2e-coverage` prints which config OWNS each spec — read it there. |
| `tests/docs-shots/**/*.shots.ts` | `docs:shots` (NOT a test suite) | `playwright.docs-shots.config.ts` |

## tests/docs-shots

`tests/docs-shots/` is the odd one out and deliberately so: those files are a
**documentation build step**, not tests. They walk the real product and
photograph it, so every screenshot in the user guide was produced by software
that actually clicked the button — a UI change that breaks a documented step
breaks the docs build instead of leaving a lie on the website. They are
`*.shots.ts` so no other config can collect them, and they carry **no copy**:
every word lives in the markdown, joined by `<!-- shot: id | alt -->` markers.

**Only this half lives here.** `npm run docs:shots` writes
`.docs-shots/<slug>/<id>.png` (gitignored) and stops. The prose those markers
belong to, the code that joins the two, and the gate that fails when they
disagree are all in the hosted product's repository, which is where the guides
are published from. This repository has no marker gate, because it has no
markers — a capture with nowhere to go is caught over there, against the prose.

## Test-placement rules (original wording)

What `CLAUDE.md` / `AGENTS.md` said before it was condensed to a short paragraph. [`testing.md`](../develop/testing.md) carries the same rules; the one sentence it lacks, "Domain dirs contain ONLY spec files", stays in the short paragraph.

Choosing a home for a new spec:
1. Frontend component/unit test? → **co-locate** beside the component as
   `Foo.test.tsx` (or `__tests__/Foo.test.tsx`) under `app/` (R2). Never in `tests/`.
2. Server-side, no browser: depends on real CF runtime semantics (Queue
   delivery, Durable Objects, workerd-only APIs)? Yes → `tests/workers/`
   (real workerd via vitest-pool-workers); no → `tests/unit/<domain>/`
   (node env, stubs + better-sqlite3).
3. Asserting on a THIRD PARTY's contract rather than our own behavior? →
   `tests/contract/<party>/`. The test: if a red run usually means "change our
   code to match theirs" rather than "fix our bug", it is a contract spec.
4. Full-stack / browser / anything hitting a running worker → `tests/e2e/`
   (R8). One directory; default `playwright.config.ts` seeds real D1 via
   `globalSetup` so every E2E exercises the actual database. `*.integration.spec.ts`
   (self-resetting, serial) and remote/staging runs are just other configs
   over the same dir — not separate directories.

`tests/docs-shots/` is a documentation build step, not a test suite (`*.shots.ts`, carries no copy, only `npm run docs:shots` runs it): [the docs-shots section above](#testsdocs-shots).

Rules: `tests/unit/<domain>/` dirs are named after the `server/api/` module (or
service family) the specs exercise — never flat specs at the root. Frontend
tests co-locate under `app/` (do not recreate `tests/web/unit/`). E2E is the
single `tests/e2e/` (do not recreate `tests/web/e2e/` or `tests/integration/`).
Domain dirs contain ONLY spec files; shared infra stays at
`tests/unit/{db,mocks,setup-client}.ts` + `helpers/` + `stubs/` and
`tests/{global-setup,seed-fixtures}.ts` + `helpers/` + `fixtures/` (fixtures
group payloads by event family, versioned filenames). `tests/workers/` stays
flat until a family reaches ~5 specs, then gets a domain dir (`mcp/` is the
example). `tests/e2e/` stays flat: one spec file = one playwright project. Every
spec must be collected by exactly one config (playwright projects must resolve).
Fully-skipped specs need a `TODO(...)` naming their blocker. Name new specs after
behavior, not sprints. Full rules for classification, writing, and run
initialization: `docs/develop/testing.md`.
