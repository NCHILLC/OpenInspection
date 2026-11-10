#!/usr/bin/env node
/**
 * Thin wrangler wrapper that resolves which config to use, matching the logic in
 * vite.config.ts so direct wrangler commands (db:migrate, etc.) stay consistent
 * with the build:
 *   WRANGLER_CONFIG env wins (e.g. saas)  ->
 *   else wrangler.local.jsonc if present (real ids) ->
 *   else committed wrangler.jsonc (placeholders / one-click).
 *
 *   node scripts/wrangler.mjs d1 migrations apply DB --local
 *
 * Cloudflare answers an expired OAuth token with error 7403. `wrangler whoami`
 * refreshes the token as a side effect, so on 7403 this runs it once (output
 * discarded: nothing token-related is ever printed) and retries the command once.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** True when wrangler's output says Cloudflare rejected the token with 7403. */
export function isExpiredToken(text) {
  return /\b7403\b/.test(String(text ?? ''));
}

function main() {
  const cfg =
    process.env.WRANGLER_CONFIG ||
    (existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');

  const args = process.argv.slice(2);
  const run = () => {
    const r = spawnSync('npx', ['wrangler', ...args, '-c', cfg], {
      shell: true,
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    process.stdout.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    return r;
  };

  let r = run();
  if (r.status !== 0 && isExpiredToken(`${r.stdout}\n${r.stderr}`)) {
    console.error('wrangler: Cloudflare error 7403; running `wrangler whoami` once to refresh the login, then retrying.');
    spawnSync('npx', ['wrangler', 'whoami'], { shell: true, stdio: 'ignore' });
    r = run();
  }
  process.exit(r.status ?? 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
