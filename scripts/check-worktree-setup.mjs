#!/usr/bin/env node
/**
 * Stops early, with the fix, when this checkout was never set up.
 *
 * `npm ci` runs the `prepare` script, which writes the generated files the type
 * checker and the build import. A new git worktree has neither node_modules nor
 * those files, and one whose node_modules is a junction to the main checkout
 * has the packages but still skipped `prepare`. Without this check the failure
 * shows up later as `Cannot find module './generated/version'` or
 * `~/paraglide/messages`, which names a symptom rather than the missing step.
 *
 * `--deps-only` checks node_modules alone: the build regenerates the rest
 * itself, so the pre-push bundle gate needs only the packages.
 *
 * No imports beyond node: it has to run before node_modules exists.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const depsOnly = process.argv.includes('--deps-only');

if (!existsSync(join(root, 'node_modules', '.bin'))) {
    console.error('[setup] node_modules missing: run `npm ci` in this worktree, then `npm run worktree:setup`.');
    process.exit(1);
}

if (!depsOnly) {
    const generated = ['server/generated/version.ts', 'app/paraglide/messages.js'];
    const missing = generated.filter((f) => !existsSync(join(root, f)));
    if (missing.length > 0) {
        console.error(`[setup] generated files missing (${missing.join(', ')}): run \`npm run worktree:setup\` in this worktree.`);
        process.exit(1);
    }
}
