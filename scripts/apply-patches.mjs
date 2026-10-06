#!/usr/bin/env node
/**
 * Applies every `patches/*.patch` to node_modules. Runs from `postinstall`.
 *
 * `git apply`, not patch-package: patch-package installs `braces` (through
 * find-yarn-workspace-root and micromatch), and braces carries an advisory with
 * no patched release (GHSA-vfj7-8cjw-p6xm). An advisory nobody can update past
 * is cleared only by not installing the package. The patch files are plain git
 * diffs rooted at the repository, so git applies them as they are.
 *
 * A patch that does not apply FAILS the install. Whether the result is in the
 * bytes that run is `lint:wrangler-patch`'s job, not this script's.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const DIR = new URL('../patches/', import.meta.url);
const ROOT = new URL('..', import.meta.url);

function gitApply(file, ...flags) {
    execFileSync('git', ['apply', ...flags, `patches/${file}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
}

for (const file of readdirSync(DIR).filter((name) => name.endsWith('.patch'))) {
    try {
        // A patch that reverses cleanly is already applied: `npm install` on an
        // existing tree runs this again and must not fail there.
        gitApply(file, '--reverse', '--check');
        console.log(`[patches] ${file}: already applied`);
        continue;
    } catch { /* not applied yet */ }

    try {
        gitApply(file);
        console.log(`[patches] ${file}: applied`);
    } catch (err) {
        console.error(`[patches] FAIL: ${file} does not apply.\n${String(err.stderr ?? err.message).trim()}`);
        console.error('The patched package moved. Re-cut the patch against the installed version, or delete it if upstream carries the fix.');
        process.exit(1);
    }
}
