/**
 * The refusals that stand between an appointment and a new slot.
 *
 * INVARIANT: every path that moves an appointment runs the same refusal. There
 * is more than one door — the dispatch board drags to an instant through
 * `PATCH /inspections/:id/schedule`, the calendar drags to a civil day through
 * the generic `PATCH /inspections/:id` — and a closed-day policy or a
 * double-booking block that only one door honours is not a policy, it is a
 * suggestion with a way around it.
 *
 * Callers own their envelope and status codes; this returns WHAT was refused
 * and why, never a Response. `conflicts` comes back either way: with a refusal
 * it is the evidence, without one it is the advisory list the caller reports
 * alongside a successful write.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { findScheduleConflicts } from './schedule-conflicts';
import { resolveInternalHolidayEffect } from './holidays/load-tenant-holidays';

export interface ScheduleConflict {
    inspectionId: string;
    propertyAddress: string;
    date: string;
    inspectorId: string;
}

export interface ScheduleRefusal {
    code: 'HOLIDAY_BLOCKED' | 'SCHEDULE_CONFLICT';
    message: string;
    conflicts?: ScheduleConflict[];
}

export interface ScheduleGuardInput {
    /** Tenant-civil day the move lands on (YYYY-MM-DD). */
    civilDate: string;
    /** Tenant wall-clock HH:MM on that day, or NULL when the appointment names
     *  no time. Null is not midnight: `sameDayHour` treats a bare `YYYY-MM-DD`
     *  as colliding with anything that day, which is what a timeless job means,
     *  while `…T00:00` is an hour bucket that misses every timed job on it. */
    hm: string | null;
    /** The proposed interval. A null start degrades conflict detection to the
     *  hour bucket, exactly as it already does for a row without an instant. */
    startMs: number | null;
    endMs: number | null;
    /** Everyone who would work it — lead and helpers. */
    assignees: string[];
    /** The inspection being moved; it cannot collide with itself. */
    excludeId: string;
    /** Tenant `booking_conflict_policy`. `advisory` warns, `block` refuses. */
    policy: 'advisory' | 'block';
}

export async function findScheduleRefusal(
    db: DrizzleD1Database,
    database: D1Database,
    tenantId: string,
    input: ScheduleGuardInput,
): Promise<{ refusal: ScheduleRefusal | null; conflicts: ScheduleConflict[] }> {
    const holiday = await resolveInternalHolidayEffect(database, tenantId, input.civilDate);
    if (holiday.effect === 'block') {
        return {
            refusal: {
                code: 'HOLIDAY_BLOCKED',
                message: holiday.name
                    ? `Cannot schedule on ${holiday.name} — company holidays are blocked.`
                    : 'Cannot schedule on a company closed day.',
            },
            conflicts: [],
        };
    }

    const conflicts: ScheduleConflict[] = [];
    for (const inspectorId of input.assignees) {
        const found = await findScheduleConflicts(
            db,
            tenantId,
            inspectorId,
            input.hm ? `${input.civilDate}T${input.hm}` : input.civilDate,
            input.excludeId,
            { startMs: input.startMs, endMs: input.endMs },
        );
        for (const hit of found) conflicts.push({ ...hit, inspectorId });
    }

    if (input.policy === 'block' && conflicts.length > 0) {
        return {
            refusal: {
                code: 'SCHEDULE_CONFLICT',
                message: 'That slot overlaps existing work and this company blocks double-booking.',
                conflicts,
            },
            conflicts,
        };
    }

    return { refusal: null, conflicts };
}
