#!/usr/bin/env node
/**
 * Deploy guard: runs first in `npm run deploy` / `deploy:saas`.
 *
 * Those scripts build the WORKING TREE, so a deploy from a stale branch, a
 * local-only commit or a dirty tree ships something that is not on `main`.
 * This fails unless HEAD equals `origin/main` (after fetching it) and no
 * tracked file is modified. On success it prints the short sha being deployed
 * and the migrations the remote database has not applied yet. Listing them is
 * informational: if it fails, that is printed and the deploy carries on (the
 * `db:lag` step later in the deploy script is the fail-closed check).
 *
 *   node scripts/deploy-guard.mjs [--label saas]   # extra args go to check-migration-lag
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Pure verdict over git facts, exported for the spec. */
export function evaluateGitState({ head, originMain, dirtyFiles }) {
  const problems = [];
  if (!head) problems.push('could not read HEAD');
  if (!originMain) problems.push('could not read origin/main');
  if (head && originMain && head !== originMain) {
    problems.push(`HEAD (${head.slice(0, 8)}) is not origin/main (${originMain.slice(0, 8)}). Check out main and pull.`);
  }
  if (dirtyFiles.length) {
    problems.push(`tracked files have uncommitted changes:\n    ${dirtyFiles.join('\n    ')}`);
  }
  return { ok: problems.length === 0, problems };
}

/** Parse `git status --porcelain` keeping tracked changes only (untracked `??` are not built from). */
export function trackedChanges(porcelain) {
  return String(porcelain ?? '')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('??'))
    .map((l) => l.slice(3));
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').replace(/\s+$/, '') };
}

function main() {
  const fetched = git(['fetch', 'origin', 'main']);
  if (!fetched.ok) {
    console.error('✘ deploy guard: `git fetch origin main` failed; cannot confirm HEAD is current.');
    process.exit(1);
  }
  const head = git(['rev-parse', 'HEAD']).out;
  const originMain = git(['rev-parse', 'origin/main']).out;
  const status = git(['status', '--porcelain']);
  if (!status.ok) {
    console.error('✘ deploy guard: `git status` failed.');
    process.exit(1);
  }
  const verdict = evaluateGitState({ head, originMain, dirtyFiles: trackedChanges(status.out) });
  if (!verdict.ok) {
    console.error('\n✘ deploy guard: refusing to deploy.');
    for (const p of verdict.problems) console.error(`  - ${p}`);
    console.error('\n  `npm run deploy` builds the working tree, so it must match origin/main.\n');
    process.exit(1);
  }
  console.log(`✔ deploy guard: HEAD is origin/main at ${head.slice(0, 8)}, tracked tree clean.`);

  // Informational: what the remote database has not applied yet.
  const lag = spawnSync('node', [resolve(ROOT, 'scripts/check-migration-lag.mjs'), ...process.argv.slice(2)], {
    cwd: ROOT, encoding: 'utf8', timeout: 150_000,
  });
  const text = `${lag.stdout ?? ''}${lag.stderr ?? ''}`.trim();
  if (lag.status === 0) {
    console.log(text || 'Pending remote migrations: none.');
  } else {
    console.log('Pending remote migrations (the listing exited non-zero; deploy continues, `db:lag` re-checks later):');
    console.log(text || `(no output; exit ${lag.status ?? lag.error?.message})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
