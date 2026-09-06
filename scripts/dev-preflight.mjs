#!/usr/bin/env node
/**
 * Dev-server preflight — answer "am I about to test the code I think I am?"
 *
 * Every check here is a trap that has actually cost a session, not a
 * hypothetical:
 *
 *  1. WORKTREE SHADOWING. Worktrees living under the main checkout (the old
 *     `.claude/worktrees/`) make the preview launcher resolve the project root
 *     to the WORKTREE. On 2026-09-06 that served a 3-day-old build of a
 *     different branch on the expected port, with `/status` cheerfully
 *     reporting the wrong commit. An absolute path in launch.json does not
 *     help — the launcher rebases it onto the root it picked.
 *
 *  2. A ZOMBIE SERVER. `wrangler dev` can leave workerd alive while the proxy
 *     that binds the user-facing port is gone. The process list looks healthy,
 *     the port refuses connections, and the build directory stays locked
 *     (EBUSY on rmdir), so the next `npm run build` fails for a reason that
 *     looks nothing like the cause.
 *
 *  3. A STALE BUILD. `server/generated/version.ts` is written by gen-version at
 *     build time. If its commit is not HEAD, the bundle predates the code being
 *     tested and any result is about the wrong source.
 *
 *  4. IPv6-ONLY BIND. The vite dev server binds ::1, so probes against
 *     127.0.0.1 return nothing at all and read as "server is down".
 *
 * Usage:  node scripts/dev-preflight.mjs [--url http://localhost:5173]
 * Exit 0 = clear, 1 = something would invalidate a test run.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const urlArg = process.argv.indexOf("--url");
const url = urlArg > -1 ? process.argv[urlArg + 1] : null;

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const problems = [];
const notes = [];

// ── 1. worktrees inside the checkout ────────────────────────────────────────
const root = resolve(sh("git rev-parse --show-toplevel"));
const inside = sh("git worktree list")
    .split("\n")
    .map((l) => l.split(/\s+/)[0])
    .filter((p) => p && resolve(p) !== root && resolve(p).startsWith(root + "\\") || (p && resolve(p) !== root && resolve(p).startsWith(root + "/")));
if (inside.length) {
    problems.push(
        `worktree shadowing: ${inside.length} worktree(s) live INSIDE the checkout —\n` +
        inside.map((p) => `      ${p}`).join("\n") +
        `\n      The preview launcher may resolve the project root to one of these and serve its build.\n` +
        `      Fix: git worktree move <path> <somewhere outside the repo>`,
    );
}

// ── 2/3. the build, and whether it is this commit ───────────────────────────
const head = sh("git rev-parse HEAD");
const versionFile = resolve(root, "server/generated/version.ts");
if (!existsSync(resolve(root, "build/server/index.js"))) {
    problems.push("no build: build/server/index.js is missing — run npm run build.");
} else if (existsSync(versionFile)) {
    const built = /commit: '([0-9a-f]+)'/.exec(readFileSync(versionFile, "utf8"))?.[1];
    if (!built) notes.push("version.ts has no commit field — cannot compare the build to HEAD.");
    else if (!head.startsWith(built) && !built.startsWith(head.slice(0, built.length))) {
        problems.push(`stale build: bundle was built from ${built.slice(0, 8)}, HEAD is ${head.slice(0, 8)}. Rebuild.`);
    } else {
        notes.push(`build matches HEAD (${built.slice(0, 8)}).`);
    }
}

// ── 4. the server actually answering, on the host it binds ─────────────────
if (url) {
    const bases = [url, url.replace("127.0.0.1", "localhost"), url.replace("localhost", "127.0.0.1")];
    let answered = null;
    // 25s, not 5: on the HMR server /status is an SSR route that COMPILES on the
    // first hit. A short timeout reports a healthy server as dead, which is the
    // same false alarm this script exists to prevent, pointed the other way.
    for (const base of [...new Set(bases)]) {
        try {
            const res = await fetch(new URL("/status", base), { signal: AbortSignal.timeout(25000) });
            if (res.ok) { answered = { base, body: await res.json() }; break; }
        } catch { /* try the next host spelling — a ::1-only bind refuses 127.0.0.1 outright */ }
    }
    if (!answered) {
        problems.push(
            `no server answering at ${url} (tried localhost and 127.0.0.1).\n` +
            `      A process can still be alive and holding the build directory. On Windows:\n` +
            `      Get-NetTCPConnection -State Listen -LocalPort <port>`,
        );
    } else {
        const served = answered.body.commit ?? "?";
        if (!head.startsWith(served)) {
            problems.push(
                `WRONG TREE: ${answered.base} serves commit ${served} (branch ${answered.body.branch ?? "?"}), HEAD is ${head.slice(0, 8)}.\n` +
                `      Anything measured against this server is about different source.`,
            );
        } else {
            notes.push(`${answered.base} serves ${served} — matches HEAD.`);
        }
    }
}

for (const n of notes) console.log(`  ok    ${n}`);
for (const p of problems) console.error(`  WARN  ${p}`);
console.log(problems.length ? `\npreflight: ${problems.length} problem(s) — a test run now may prove nothing.` : "\npreflight: clear.");
process.exit(problems.length ? 1 : 0);
