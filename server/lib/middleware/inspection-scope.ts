import type { Context, Next } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { ROLE } from '../auth/roles';
import { ANONYMOUS_API_ALLOW, matchesRule } from '../auth/api-access-policy';
import { requireRole } from './rbac';
import type { HonoConfig } from '../../types/hono';

const staffOnly = requireRole(ROLE.OWNER, ROLE.MANAGER, ROLE.INSPECTOR);

/**
 * Path guard for everything under `/api/inspections/:id`. One middleware covers the
 * whole family, so a route added later is protected by default instead of having to
 * remember to wear a guard of its own. Paths the access policy lets through without a
 * session (the published report's video) keep that exemption.
 */
function inspectionScopeGuard() {
    return async (c: Context<HonoConfig>, next: Next) =>
        matchesRule(ANONYMOUS_API_ALLOW, c.req.path) ? next() : staffOnly(c, next);
}

/**
 * Must run before any route is mounted: Hono applies middleware only to handlers
 * registered after it.
 */
export function registerInspectionScopeGuards(app: OpenAPIHono<HonoConfig>): void {
    const guard = inspectionScopeGuard();
    app.use('/api/inspections/:id', guard);
    app.use('/api/inspections/:id/*', guard);
}
