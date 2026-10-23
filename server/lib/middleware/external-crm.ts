import type { MiddlewareHandler } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { Errors } from '../errors';

/**
 * The public booking surface: company page data, slots, availability, the
 * create-booking POST, the booking deposit and the embed widget's events.
 *
 * Registered with `use('*')` on the bookings router, which lands on all of
 * `/api/public/*`: that mount is shared with the report, portal, signing and
 * geocode routes, which stay up. So this list, not the mount, decides.
 */
const PUBLIC_BOOKING =
    /^\/api\/public\/(book(\/|$)|inspectors$|services$|availability\/|slots$|inspections\/[^/]+\/deposit-intent$|widget\/)/;

/**
 * While another system is the CRM (`profile.externalCrm`) it takes the bookings,
 * so OI's public booking answers 404 as if it did not exist. Staff APIs stay open.
 */
export const refusePublicBookingWhenExternalCrm: MiddlewareHandler<HonoConfig> = async (c, next) => {
    // `?.`: route specs mount this router without contextBootstrap.
    if (c.var.profile?.externalCrm && PUBLIC_BOOKING.test(c.req.path)) throw Errors.NotFound();
    await next();
};
