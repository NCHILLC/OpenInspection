import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMcpSurfacePath } from '../../../server/lib/mcp/oauth-paths';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';

const STANDALONE = getDeploymentProfile({ APP_MODE: 'standalone' }).mcpApiRoute;
const SAAS = getDeploymentProfile({ APP_MODE: 'saas' }).mcpApiRoute;

/**
 * The worker entry loads the MCP/OAuth graph only for requests that belong to
 * it. Everything this predicate rejects is a request that must never pay for
 * that graph; everything it accepts would 404 for MCP clients if it did not.
 */
describe('isMcpSurfacePath', () => {
    it('accepts the standalone mount path and its subtree', () => {
        expect(isMcpSurfacePath('/mcp', STANDALONE)).toBe(true);
        expect(isMcpSurfacePath('/mcp/messages', STANDALONE)).toBe(true);
    });

    // SaaS mounts per-workspace endpoints UNDER the same /mcp prefix
    // (InspectorHub/OpenInspection a4620cd1 narrowed it from /company/).
    it('accepts the saas per-workspace endpoint under the shared prefix', () => {
        expect(isMcpSurfacePath('/mcp', SAAS)).toBe(true);
        expect(isMcpSurfacePath('/mcp/acme', SAAS)).toBe(true);
    });

    it('accepts the configured OAuth endpoints', () => {
        for (const p of ['/oauth/authorize', '/oauth/token', '/oauth/register']) {
            expect(isMcpSurfacePath(p, STANDALONE)).toBe(true);
        }
    });

    it('accepts both discovery documents the provider serves itself', () => {
        expect(isMcpSurfacePath('/.well-known/oauth-authorization-server', STANDALONE)).toBe(true);
        expect(isMcpSurfacePath('/.well-known/oauth-protected-resource', STANDALONE)).toBe(true);
    });

    // The bug a naive `startsWith(apiRoute)` would ship: '/mcpanything' is NOT
    // the MCP surface, and routing it there would hand an ordinary page to the
    // OAuth provider.
    it('does not match a path that merely begins with the same letters', () => {
        expect(isMcpSurfacePath('/mcpanything', STANDALONE)).toBe(false);
    });

    it('rejects ordinary application paths', () => {
        for (const p of ['/', '/inspections', '/login', '/api/inspections', '/.well-known/other']) {
            expect(isMcpSurfacePath(p, STANDALONE)).toBe(false);
        }
    });

    // /company/* is an ordinary application namespace in BOTH modes now; the
    // old broad SaaS prefix swallowed all of it.
    it('does not treat the company namespace as MCP in either mode', () => {
        expect(isMcpSurfacePath('/company/acme/mcp', STANDALONE)).toBe(false);
        expect(isMcpSurfacePath('/company/acme/mcp', SAAS)).toBe(false);
    });
});

/**
 * The regression guard for Cloudflare error 1102.
 *
 * A static import of either module from the worker entry pulls the MCP SDK, the
 * Agents SDK, the OAuth provider and zod into the EAGER module graph, which is
 * evaluated on every cold start. That cost — 1,117 KB of a 1,259 KB graph —
 * exceeded the Worker startup limit and returned 1102 on ordinary page loads,
 * including pages that never touch MCP. Both must be reached by `import()` only.
 */
describe('the worker entry does not eagerly import the MCP graph', () => {
    const entry = readFileSync(resolve(__dirname, '../../../workers/app.ts'), 'utf8');

    it.each([
        ['../server/lib/mcp/oauth-provider'],
        ['../server/durable-objects/inspector-mcp'],
    ])('reaches %s only through a dynamic import()', (spec) => {
        // A static import ends `from "<spec>"`; a dynamic one is `import("<spec>")`.
        expect(entry).not.toMatch(new RegExp(`from\s*["']${spec}["']`));
        expect(entry).toContain(`import("${spec}")`);
    });
});
