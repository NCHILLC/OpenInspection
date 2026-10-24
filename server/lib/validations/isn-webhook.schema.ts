import { z } from 'zod';

/**
 * The only webhook fields this app reads. ISN's body is not trusted for order
 * data (the receiver re-fetches the order), so everything else passes through.
 * `order_id` is ISN's uuid; `order_oid` the numeric order number. Either opens
 * the order over REST.
 */
export const IsnWebhookSchema = z.object({
    event_id: z.string().optional(),
    action:   z.string().optional(),
    test:     z.boolean().optional(),
    order_id: z.string().min(1).optional(),
    order_oid: z.union([z.string().min(1), z.number().int()]).optional(),
}).passthrough();
