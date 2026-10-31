import { z } from '@hono/zod-openapi';
import { FIELD_LOG_KINDS } from '../db/schema/field-log';

/** The shapes are the privacy rule: nothing but a marker note can carry prose. */
export const FieldLogEventSchema = z.object({
    id: z.string().trim().min(1).max(64).describe('Device-minted event id'),
    inspectionId: z.string().min(1).max(64).describe('The inspection this happened in'),
    occurredAt: z.number().int().positive().describe('Device time in epoch milliseconds'),
    kind: z.enum(FIELD_LOG_KINDS).describe('What sort of event this is'),
    name: z.string().regex(/^[\w.:-]{1,64}$/).describe('An action or screen name, never prose'),
    route: z.string().regex(/^\/[\w\-./:]{0,199}$/).optional().describe('A path with no query string'),
    status: z.number().int().min(100).max(599).optional().describe('HTTP status of a failed request'),
    note: z.string().trim().min(1).max(500).optional().describe('What the inspector typed on a Mark issue marker'),
}).refine((e) => e.note === undefined || e.kind === 'issue', { message: 'Only an issue marker carries a note' });

export const FieldLogUploadSchema = z.object({
    events: z.array(FieldLogEventSchema).min(1).max(100).describe('Oldest buffered events from the device'),
});

export const FieldLogSettingSchema = z.object({ enabled: z.boolean().describe('Whether the field log records this user') });

export const FieldLogInspectionParamSchema = z.object({ id: z.string().min(1).max(64).describe('The inspection id') });

const TimelineEventSchema = z.object({
    id: z.string(),
    userId: z.string(),
    occurredAt: z.number(),
    kind: z.enum(FIELD_LOG_KINDS),
    name: z.string(),
    route: z.string().nullable(),
    status: z.number().nullable(),
    note: z.string().nullable(),
});

export const FieldLogTimelineSchema = z.object({
    events: z.array(TimelineEventSchema),
    /** Each issue marker with the events from the minutes before it. */
    issues: z.array(TimelineEventSchema.extend({ precedingEventIds: z.array(z.string()) })),
});
