// Single-worker entry (cloudflare/react-router-hono-fullstack-template shape):
// Hono is the worker entry; it mounts the full OpenInspection API and delegates
// every other path to the React Router SSR handler. Replaces the dual-worker
// (API worker + web worker + Service Binding) topology with one deployable.
import { Hono, type Context } from "hono";
import { createRequestHandler, RouterContextProvider } from "react-router";
// buildOAuthHandler is NOT imported here. Importing it statically pulled the
// MCP SDK, the Cloudflare Agents SDK, the OAuth provider and zod into the EAGER
// module graph — 1,117 KB of the 1,259 KB evaluated on every cold start, for a
// surface that answers 404 unless MCP_ENABLED is set. That is what exceeded the
// Worker STARTUP limit and returned Cloudflare 1102 on ordinary page loads.
// These two imports are safe at the top level: `flag` and `oauth-paths` import
// nothing at all, and `deployment-profile` (below) is two constants and a
// resolver.
import { mcpEnabled } from "../server/lib/mcp/flag";
import { isMcpSurfacePath } from "../server/lib/mcp/oauth-paths";
// Safe at the top level despite this entry's tiny-import-graph rule:
// `deployment-profile.ts` imports nothing at all — it is two constants and a
// resolver over `ProfileEnv`. Pulling it in does not drag the API graph in
// behind it, which is the thing that rule protects.
import { getDeploymentProfile } from "../server/lib/deployment-profile";
// i18n Phase C — request-scoped locale. paraglideMiddleware establishes an
// AsyncLocalStorage scope so getLocale()/m.*() resolve per-request (never a
// module-global) across the multi-tenant Worker. Generated (git-ignored); the
// paraglide vite plugin + the prebuild `i18n:compile` step keep it present.
import { paraglideMiddleware } from "../app/paraglide/server.js";
// i18n activation (#269) — the request-borne half of locale resolution. Runs
// BEFORE paraglideMiddleware because paraglide reads the locale off the
// INCOMING request: a locale decided later cannot change the render that is
// already under way. See the seam note in ui-locale.ts.
import { withResolvedUiLocale } from "../server/lib/i18n/ui-locale";
import type { WorkerEnv } from "./env";
import { cloudflareContext } from "../app/lib/load-context";

/** Hono context for this worker, so handlers need no `any`. */
type Ctx = Context<{ Bindings: WorkerEnv }>;

// The load context is a RouterContextProvider seeded per request in `ssr()`
// below; `cloudflareContext` is its only key. No `AppLoadContext` module
// augmentation any more — that interface is unused once middleware is on.

// The API graph (server/index → every route/service/dep) is imported LAZILY.
// Evaluating it at module top-level breaks `react-router dev`: the
// @cloudflare/vite-plugin dev runner evaluates the worker entry under Vite's
// SSR transform to detect export types, and a transitive CJS dep in the API
// graph crashes that evaluation (the build + real-workerd path is unaffected).
// Deferring the import keeps the entry's top-level graph tiny, so dev-mode
// export-type detection succeeds; the first real request pays a one-time
// (cached) import. See docs/develop/architecture.md for the dev-mode notes.
type ApiModule = typeof import("../server/index");
let apiModule: Promise<ApiModule> | undefined;
const getApi = () => (apiModule ??= import("../server/index"));

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// React Router SSR. We inject an in-process `API_WORKER` self-binding so that
// loaders/actions' `createApi()` call the API app DIRECTLY (its createApi prefers
// env.API_WORKER.fetch) instead of an HTTP loopback to this same worker — no
// extra network hop, no API_URL needed.
const ssr = (c: Ctx) => {
  const env: WorkerEnv = {
    ...c.env,
    API_WORKER: {
      fetch: async (req: Request) =>
        (await getApi()).app.fetch(req, c.env, c.executionCtx),
    },
  };
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env, ctx: c.executionCtx });
  // Run the whole RR pipeline (loaders → actions → render) INSIDE the paraglide
  // ALS scope, so getLocale()/m.*() resolve to this request's locale in server
  // loaders/actions AND during SSR. cookie strategy ⇒ no URL rewrite/redirect,
  // so the callback's request is the original.
  //
  // This stays wrapped AROUND requestHandler rather than becoming a route
  // middleware: it has to cover loaders, actions, AND the render pass, and only
  // the outer position does. Moving it inside would narrow the scope silently —
  // locale would fall back to baseLocale with nothing raising an error.
  //
  // withResolvedUiLocale stamps the resolved locale into the Cookie header the
  // middleware is about to read, so a first visit renders in the visitor's
  // language instead of English-then-Spanish. It returns the SAME request
  // object once the cookie already agrees, which is every request after the
  // first — the steady-state cost here is one header read.
  return paraglideMiddleware(withResolvedUiLocale(c.req.raw), ({ request }) =>
    requestHandler(request, context),
  );
};

// Delegate to the FULL API app (all its global `app.use('*')` middleware — CSRF,
// tenant routing, DI, branding, … — runs INSIDE this call). By routing only
// API-owned paths here, that middleware never blankets frontend routes, which is
// what caused the CSRF 403 on the frontend's /login POST when the API was mounted
// at "/". Mirrors the CF template's "explicit API routes before the catch-all".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toApi = async (c: any) =>
  (await getApi()).app.fetch(c.req.raw, c.env, c.executionCtx);

const app = new Hono();

// --- API-owned paths → the API app (with its middleware). Routing audit done. ---
// Bulk API surface + genuine non-/api endpoints with no React Router page:
// SaaS-Portal M2M integration: mounted only where the surface exists. Where it
// does not, the prefix 404s — there is no platform on the other end, and a
// surface that answers is a surface somebody probes. See server/portal/.
//
// This runs before any middleware, so `c.var.profile` is not available — but
// `getDeploymentProfile` takes `ProfileEnv`, not `AppEnv`, and that widening
// exists for exactly this class of caller. It was reading `APP_MODE` under an
// allowlist entry whose stated reason ("runs before middleware") was true of
// the context and not of the function.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.all("/api/integration/*", (c: any) =>
    getDeploymentProfile(c.env).hasPortalIntegrationApi ? toApi(c) : c.notFound(),
);
app.all("/api/*", toApi);
app.all("/status", toApi);
app.all("/m2m/*", toApi);
app.all("/photos/*", toApi);
app.all("/.well-known/*", toApi);
app.all("/doc", toApi); // OpenAPI JSON (the RR /ui Swagger page fetches it); /ui itself is now an RR route
app.all("/sso", toApi); // saas SSO handoff (coreAuthRoutes is also mounted at '/')
app.all("/sign/*", toApi); // public signing pages — no React Router /sign route
app.all("/agent/magic-login", toApi); // agent unified link redeem — no React Router page for this path
app.get("/inspector/:tenant/:slug/calendar.ics", toApi); // ICS feed (API-only)
app.get("/observe/:token", toApi); // 1-seg observe — RR owns /observe/inspections/:id

// Audited as React Router-owned (the RR migration superseded the API HTML; the API
// still serves their DATA under /api/public/*): /book /report /r /messages /verify
// /agreements /login /logout /forgot-password /inspections and all app pages.

// --- Everything else → React Router SSR (all pages incl. "/") ---
// Static assets (/favicon.svg, /styles.css, /vendor/*, /fonts/*) are served by the
// Cloudflare assets layer from build/client before the worker runs.
app.all("*", ssr);

// fetch from the merged Hono app; scheduled (cron) + queue (sync DLQ consumer)
// reused from the API handler. The queue handler is defined in server/index.ts
// (the allowed portal-import composition point) so this entry never imports
// server/portal/* statically — it just forwards the runtime invocation.
//
// buildOAuthHandler wraps app.fetch with an OAuthProvider when MCP_ENABLED is
// set, mounting the OAuth token endpoints and Bearer-protecting the MCP API
// route. When the flag is off the call is a no-op pass-through.
export default {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetch: (req: Request, env: any, ctx: ExecutionContext) => {
    // Gate on the FLAG and the PATH, not the flag alone. Gating only on the
    // flag would move the whole MCP graph onto the first request of every
    // isolate the moment MCP is enabled, because this wrapper sits in front of
    // all traffic. Gating on the path as well means enabling MCP costs nothing
    // for anyone who is not an MCP client.
    if (!mcpEnabled(env) || !isMcpSurfacePath(new URL(req.url).pathname, getDeploymentProfile(env).mcpApiRoute)) {
      return app.fetch(req as never, env, ctx);
    }
    return import("../server/lib/mcp/oauth-provider").then((m) =>
      m.buildOAuthHandler(app.fetch as never, env).fetch(req, env, ctx),
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduled: async (controller: any, env: any, ctx: any) =>
    (await getApi()).default.scheduled(controller, env, ctx),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queue: async (batch: any, env: any, ctx: any) =>
    (await getApi()).default.queue(batch, env, ctx),
};

// Re-export Durable Objects + Workflow so wrangler can bind them on the single
// worker (their class names are referenced by the combined wrangler config).
// These MUST stay static (wrangler binds the classes at module scope); their
// import graphs must stay light — see the lazy-API note above.
export { InspectionPresenceDO } from "../server/durable-objects/inspection-presence";
export { TenantPresenceDO } from "../server/durable-objects/tenant-presence";
export { InspectionDocDO } from "../server/durable-objects/inspection-doc";
/**
 * `InspectorMcp` is a LAZY STUB, and the other four re-exports above are not.
 *
 * wrangler binds a Durable Object by reading a class off this module at module
 * scope, so the class must exist eagerly — but its IMPLEMENTATION need not.
 * Re-exporting the real one dragged the MCP + Agents + OAuth + zod graph into
 * every cold start (see the buildOAuthHandler note at the top of this file).
 * The other DOs stay direct re-exports because their graphs are small; this is
 * the only one worth the indirection.
 *
 * ⚠️ UNPROVEN AT RUNTIME. With MCP_ENABLED off nothing routes here, so this
 * class is dormant and its delegation has never executed. It forwards the
 * standard Durable Object entry points; `McpAgent` may rely on surface this
 * does not forward (RPC methods, hibernation hooks added by a future Agents
 * SDK). EXERCISE AN ACTUAL MCP SESSION BEFORE TRUSTING IT — turning MCP on is
 * what makes this code live.
 */
export class InspectorMcp {
  #state: unknown;
  #env: unknown;
  #real: Promise<{ [k: string]: (...a: unknown[]) => unknown }> | undefined;

  constructor(state: unknown, env: unknown) {
    this.#state = state;
    this.#env = env;
  }

  /** Loads and constructs the real agent once per DO instance. */
  #load() {
    return (this.#real ??= import("../server/durable-objects/inspector-mcp").then(
      (m) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new (m.InspectorMcp as any)(this.#state, this.#env),
    ));
  }

  async fetch(request: Request): Promise<Response> {
    return (await this.#load()).fetch(request) as Promise<Response>;
  }
  async alarm(): Promise<void> {
    await (await this.#load()).alarm?.();
  }
  async webSocketMessage(ws: unknown, message: unknown): Promise<void> {
    await (await this.#load()).webSocketMessage?.(ws, message);
  }
  async webSocketClose(ws: unknown, code: unknown, reason: unknown, wasClean: unknown): Promise<void> {
    await (await this.#load()).webSocketClose?.(ws, code, reason, wasClean);
  }
  async webSocketError(ws: unknown, error: unknown): Promise<void> {
    await (await this.#load()).webSocketError?.(ws, error);
  }
}
export { SignCompletionWorkflow } from "../server/workflows/sign-completion-workflow";
