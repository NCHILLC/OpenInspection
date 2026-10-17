# Architecture notes

Reference material moved verbatim out of `CLAUDE.md` / `AGENTS.md`. The two standing rules it contains (`useOfflineQueue` is retired; `shared-ui/src/index.ts` is the component list) stay in those files.

## Core Architecture

### Single-Worker Architecture
OpenInspection runs as ONE Cloudflare Worker (cloudflare/react-router-hono-fullstack-template shape):

- **`workers/app.ts`** — a Hono app is the worker entry. It mounts the full API (`server/`) for API-owned paths and delegates everything else to the React Router v8 SSR handler. It injects an **in-process `API_WORKER` self-binding** so React Router loaders/actions call the API app DIRECTLY (no network hop, no second worker, no Service Binding).
- **`server/`** — Hono + Drizzle + D1. All business logic, authentication, and data access. Typed JSON API.
- **`app/`** — React Router v8 + React 19 + Tailwind v4. Server-side renders the React UI on the edge.
- **`packages/shared-ui/`** — Design System 0523 token-based React components.
- **`packages/api-types/`** — Re-exports the Hono app type so `hono/client` gets full end-to-end type safety.

**Token Relay BFF** pattern: the React Router v8 server holds the JWT cookie and forwards it to the in-process API on every request, so the browser never sees the token.

### Authentication
- JWT-based (ES256 / ECDSA P-256, HttpOnly cookie `__Host-inspector_token`). Multi-version keyring with `kid` header for safe rotation — see `server/lib/jwt-keyring.ts`.
- Supports both Cookie (dashboard) and Bearer Header (API) token delivery.
- PBKDF2-SHA256 password hashing (100k iterations, 16-byte salt). Legacy SHA-256 hashes auto-rehashed on login.
- **SaaS login is portal-only.** When `APP_MODE=saas` (any topology, after silo-deconvergence 2026-05-29), `GET /login` and `GET /forgot-password` 302 to `${PORTAL_API_URL}/login` (resp. `/forgot-password`), and `POST /api/auth/login` returns HTTP 410 `LOGIN_MOVED_TO_PORTAL`. Reason: SaaS deploys share one core D1 holding users for many tenants and `users.email` is unique per-`(tenant_id, email)` (composite unique index in `schema/tenant.ts`), so a local form can't disambiguate the tenant. SaaS entry into core is exclusively via portal's `POST /api/account/handoff` → `GET /sso?code=` flow. Standalone is unchanged (single-tenant mapping is unambiguous).
- **Switch workspace UI.** `MainLayout` renders a "Switch workspace" sidebar entry (desktop bottom + mobile drawer) whenever `branding.isSaas` is true and `PORTAL_API_URL` is set, pointing at `${PORTAL_API_URL}/company/switch`. Because the JWT carries a single `custom:tenantId`, this portal bounce is the only way to swap tenants without losing the session — portal SSOs back with the new tenant's cookie (overwrites the old one).

### Standalone Engine (Single-Tenant)
- Optimized for single-tenant deployments (Private Instances).
- Resolves configuration via a fixed `SINGLE_TENANT_ID`.
- Stable API surface. The SaaS overlay is **not a branch** — it is `APP_MODE=saas` plus `server/portal/` in this same tree, read through `server/lib/deployment-profile.ts`. (This line named a `saas` branch; no such branch exists.)

### Inspection Engine
- JSON-schema based inspection templates (`server/types/template-schema.ts`, single canonical v2 — see `server/lib/validations/template.schema.ts`).
- 9 item types: `rich` (rating + 3 canned-comment tabs) plus `boolean / text / textarea / number / select / multi_select / date / photo_only` for non-rated data points. Inspection side stores rating on `result.rating` and non-rich values on `result.value`.
- Template import from another product runs through ONE front door: the wizard at `/settings/imports?intent=templates.create`. The operator declares which product the file came from, an adapter under `server/lib/migration-intake/adapters/` reads it, and the run is staged so the conversion can be reviewed and repaired before anything is written. `/templates` links to that address and owns no importer of its own — the old paste-a-JSON-document modal and its `POST /api/inspections/templates/import-spectora` endpoint are both gone.
- Support for field results, e-signatures, and report generation.
- Integrated public booking system with Turnstile bot protection. Entry point is company-level (`/book/:tenant`); bookings auto-assign the first available qualified inspector. Admins can optionally enable an inspector-choice dropdown (Settings → Online Booking → Booking policies). Legacy per-inspector deep links (`/book/:tenant/:slug`) redirect 302 to the company page with that inspector pre-selected.

## Frontend Architecture

- **Framework**: React Router v8 on Cloudflare Workers with Vite.
- **Rendering**: Full SSR — RR v8 server renders on the edge, hydrates on the client.
- **Styling**: Tailwind CSS v4 with Design System 0523 tokens (`app/styles/tailwind.css`). Tailwind is v4-only (via `@tailwindcss/vite`); no separate server-side CSS build.
- **API calls**: `hono/client` with end-to-end type safety via `packages/api-types/`. RR v8 loader/action functions call the in-process API through the injected `API_WORKER` binding (`createApi(context)` in `app/lib/api-client.server.ts`) — no network hop.
- **State management**: React hooks in `app/hooks/` — `useInspection`, `useFindings`, `useKeyboard`, `useCannedComments`, `usePresence`, `useTheme`, `useUnsavedChanges`, plus the `findings/` and `inspection/` sub-hook directories. (`useOfflineQueue` was RETIRED with the rest of the bespoke offline layer in #181; do not reach for it.)
- **Component library**: `packages/shared-ui/` — `src/index.ts` is the authoritative list (Button, IconButton, MenuItem, Pill, StatCard, Icon, Eyebrow, PageHeader, TabStrip, Input, Select, Textarea, Checkbox, Radio, RadioGroup, RadioCardGroup, EmptyState, Skeleton, Card, Banner, Modal, Drawer, Popover, Pagination, FileDropzone, Table, SegmentedControl, Avatar). Do not maintain a count here — read the file. See `docs/develop/design-system.md`.
- **Dark mode**: `data-color-scheme` attribute on `<html>`, managed by `useTheme` hook (auto/light/dark).
- **Offline**: Service Worker for the app shell; FIELD DATA is offline-capable through the Yjs results document, which `y-indexeddb` buffers locally and merges on reconnect (`docs/concepts/collab-editing.md`). Photo BINARIES are saved first to a local IndexedDB queue (`app/lib/collab/media-pending-store.ts`) and uploaded to R2 by `useMediaDrain`, on every item and defect capture, online or not. A failed upload stays queued (no timer retry: the next collab resync, `online` event or capture retries it), and the queue survives a reload or closed tab but drains only when that inspection is reopened. When it uploads is a device-local choice (`oi.uploads.syncMode`: automatic, ask, or wi-fi only; `app/lib/collab/photo-sync-mode.ts`); a manual Sync now overrides it.

## Wrangler config & deploy

One file per deploy target; the build bakes whichever config wins (vite `configPath`:
`WRANGLER_CONFIG` env > `wrangler.local.jsonc` > `wrangler.jsonc`).

| File | Tracked? | Purpose |
|---|---|---|
| `wrangler.jsonc` | committed (PLACEHOLDER ids) | standalone + the **Deploy to Cloudflare** one-click default — CF auto-provisions D1/KV/R2 and injects real ids (no real ids in the repo). |
| `wrangler.local.jsonc` | gitignored | your real standalone ids (written by `scripts/setup-cloudflare.js`). |
| `wrangler.saas.jsonc` | gitignored | SaaS-mode config (`APP_MODE=saas`, `*-saas` resources, the same three crons). Carries three queue producers — `SYNC_QUEUE`, `WORD_EXPORT_QUEUE`, `CRON_QUEUE` — plus the sync-DLQ and cmd consumers, `OAUTH_KV`, the shared `EXPORTS_BUCKET`, and a `RATE_LIMITER` unsafe binding. Multi-tenant; absent in standalone. |

`wrangler deploy` runs against the built `build/server/wrangler.json`. `scripts/wrangler.mjs`
applies the same config resolution to direct wrangler commands (db:migrate).

## Stack

- **API Framework**: [Hono](https://hono.dev/) with Zod OpenAPI.
- **Frontend Framework**: [React Router v8](https://reactrouter.com/) + React 19.
- **ORM**: [Drizzle ORM](https://orm.drizzle.team/) with D1.
- **CSS**: [Tailwind CSS v4](https://tailwindcss.com/) with Design System 0523 tokens.
- **Testing**: Vitest for unit tests; Playwright for E2E.
