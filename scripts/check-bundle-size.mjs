#!/usr/bin/env node
/**
 * C-13(b) — worker bundle-size gate.
 *
 * OpenInspection promises one-click deploys on Workers FREE, whose script
 * limit is 3 MiB **gzipped**. A bundle that drifts past it fails every
 * self-hoster's deploy — so the size is a hard pre-commit/CI gate, measured
 * with the EXACT pipeline a real deploy uses:
 *
 *   1. `npm run build` (vendor:copy + gen-version + react-router build —
 *      the real pipeline, so `virtual:react-router/server-build` resolves;
 *      the old pre-commit bundle check died trying to resolve that virtual
 *      module outside the pipeline and trained everyone to --no-verify)
 *   2. `wrangler deploy --dry-run` on the build output — wrangler's own
 *      esbuild pass produces the authoritative upload size, identical to a
 *      real deploy's "Total Upload: X KiB / gzip: Y KiB" line.
 *
 * Hard-fail above the 3 MiB limit; warn above 85% so growth is visible
 * before it becomes a deploy outage. Pass `--skip-build` when a fresh
 * build/ already exists (CI runs build as its own step).
 *
 * ── WHY THERE IS A SECOND LIMIT HERE ────────────────────────────────────────
 * Compressed upload size was never the constraint this project actually hit.
 * Cloudflare Error 1102 on /login (upstream discussion #325) fired while this
 * gate passed comfortably: the binding limit is Worker STARTUP TIME — 1 second
 * to parse and execute global scope — and nothing here measured it. Cloudflare's
 * limits page names the cause outright: "generating or consuming a large schema
 * at the top level is a common cause of exceeding this limit".
 *
 * So step 3 asserts BYTES IN THE STATIC IMPORT CLOSURE of the worker entry —
 * every chunk V8 must materialise on a cold start, before a request is served.
 * Deterministic, identical on every machine, and the number that moves when a
 * module-scope import becomes a deferred one. The 900 KB openapi-snapshot did
 * exactly that (server/durable-objects/inspector-mcp.ts) and must stay out.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const LIMIT_KIB = 3 * 1024; // Workers Free: 3 MiB gzipped script limit
const WARN_RATIO = 0.85;
const ENTRY = "build/server/index.js";
// Measured 844,158 B across 57 chunks at 5b18bdb. Headroom is deliberate and
// small: this is a ratchet, and raising it should be a decision, not a drift.
const CLOSURE_CEILING_BYTES = 880_000;

const skipBuild = process.argv.includes("--skip-build");

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

try {
  if (!skipBuild) {
    console.log("[bundle-size] building (react-router build via npm run build)…");
    sh("npm run build");
  } else if (!existsSync("build/server/wrangler.json")) {
    console.error("[bundle-size] --skip-build given but build/server/wrangler.json is missing — run npm run build first.");
    process.exit(1);
  }

  const out = sh("npx wrangler deploy --dry-run -c build/server/wrangler.json");
  const m = out.match(/Total Upload:\s*([\d.]+)\s*(KiB|MiB)\s*\/\s*gzip:\s*([\d.]+)\s*(KiB|MiB)/i);
  if (!m) {
    console.error("[bundle-size] could not find the 'Total Upload … / gzip …' line in wrangler's dry-run output — wrangler format change?");
    process.exit(1);
  }

  const toKiB = (value, unit) => (unit.toLowerCase() === "mib" ? Number(value) * 1024 : Number(value));
  const rawKiB = toKiB(m[1], m[2]);
  const gzipKiB = toKiB(m[3], m[4]);
  const pct = (gzipKiB / LIMIT_KIB) * 100;

  console.log(
    `[bundle-size] worker upload: ${rawKiB.toFixed(0)} KiB raw / ${gzipKiB.toFixed(0)} KiB gzip ` +
    `(${pct.toFixed(1)}% of the ${LIMIT_KIB / 1024} MiB Workers Free limit)`,
  );

  if (gzipKiB > LIMIT_KIB) {
    console.error(`[bundle-size] FAIL — gzip size exceeds the Workers Free 3 MiB script limit; self-host deploys would break.`);
    process.exit(1);
  }
  if (gzipKiB > LIMIT_KIB * WARN_RATIO) {
    console.warn(`[bundle-size] WARNING — above ${WARN_RATIO * 100}% of the limit; plan a diet before this becomes a deploy outage.`);
  }

  // ── 3. The eager import closure — the Error 1102 gate ─────────────────────
  // NOT the entry FILE's size. This build splits into build/server/assets/*, so
  // index.js alone is ~18 KB and a ceiling on it could never fire. The cost is
  // the transitive closure it pulls in statically.
  if (!existsSync(ENTRY)) {
    console.error(`[bundle-size] ${ENTRY} is missing — the build produced no worker entry.`);
    process.exit(1);
  }

  const seen = new Set();
  const walkChunk = (file) => {
    if (seen.has(file)) return 0;
    seen.add(file);
    let bytes = statSync(file).size;
    // Static specifiers only. A dynamic `import("./x.js")` is a separate cold
    // path and is exactly what this gate rewards, so it must NOT be counted —
    // both patterns require a bare quote where `(` would be.
    const STATIC = /(?:^|[;\s}])(?:import|export)[^;'"]*?from\s*["'](\.[^"']+)["']|(?:^|[;\s}])import\s*["'](\.[^"']+)["']/g;
    for (const m of readFileSync(file, "utf8").matchAll(STATIC)) {
      const dep = resolve(dirname(file), m[1] ?? m[2]);
      // Named, not an opaque ENOENT: a relative specifier the build did not
      // emit means the pattern above is over-matching, not that a chunk is gone.
      if (!existsSync(dep)) {
        console.error(`[bundle-size] FAIL — ${relative(process.cwd(), file)} appears to import "${m[1] ?? m[2]}", which does not exist; the closure walker is over-matching.`);
        process.exit(1);
      }
      bytes += walkChunk(dep);
    }
    return bytes;
  };
  const closureBytes = walkChunk(resolve(ENTRY));

  // A regex that quietly stops matching would make this gate vacuous — the same
  // silent-pass failure that let 1102 through. The entry has always had static
  // imports; if it appears to have none, the walker is broken, not the bundle.
  if (seen.size < 2) {
    console.error(`[bundle-size] FAIL — found no static imports from ${ENTRY}; the closure walker is broken and this gate is not measuring anything.`);
    process.exit(1);
  }

  console.log(
    `[bundle-size] eager import closure (evaluated on every cold start): ${closureBytes} bytes / ` +
    `${(closureBytes / 1024).toFixed(0)} KiB across ${seen.size} chunks (ceiling ${CLOSURE_CEILING_BYTES})`,
  );
  if (closureBytes > CLOSURE_CEILING_BYTES) {
    console.error(`[bundle-size] FAIL — eager closure exceeds the ceiling; this is what trips Cloudflare Error 1102 (Worker exceeded startup limit), which the gzip check above cannot see.`);
    console.error("[bundle-size] largest chunks in the closure — defer the biggest with a dynamic import(), or raise the ceiling deliberately:");
    for (const f of [...seen].sort((a, b) => statSync(b).size - statSync(a).size).slice(0, 10)) {
      console.error(`  ${String(statSync(f).size).padStart(9)} B  ${relative(process.cwd(), f)}`);
    }
    process.exit(1);
  }

  process.exit(0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[bundle-size] gate errored: ${msg.split("\n")[0]}`);
  process.exit(1);
}
