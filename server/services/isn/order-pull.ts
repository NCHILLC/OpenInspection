/** Compatibility entrypoint for webhook and reconcile; intake owns the behavior. */
import type { IsnConfig } from './api-base';
import { intakeIsnOrder } from './order-intake';

export async function pullIsnOrder(db: D1Database, tenantId: string, cfg: IsnConfig, orderRef: string, now = new Date()): Promise<string> {
    return (await intakeIsnOrder(db, tenantId, cfg, orderRef, now)).isnOrderId;
}
