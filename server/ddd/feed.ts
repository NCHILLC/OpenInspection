/**
 * `DddFeed` — the private findings feed for Data Driven Direction, NCHI's client site
 * (fork-only; see docs/develop/fork-log.md). A named RPC entrypoint with NO HTTP route: only a
 * Worker holding a service binding to this one can call it.
 *
 * Both methods import their implementation lazily, so this module adds nothing but the
 * `cloudflare:workers` built-in to the worker entry's eager import graph (the entry must stay
 * tiny; see workers/app.ts). The contract is SRS.md section 4 in NCHILLC/data-driven-direction.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { DddFeedEnv, DddPhoto, DddSummary } from './summary';

export class DddFeed extends WorkerEntrypoint<DddFeedEnv> {
    /** The residential Summary of the inspection's latest published report; null if unknown or commercial. */
    async inspectionSummary(inspectionId: string): Promise<DddSummary | null> {
        const { readSummary } = await import('./summary');
        return readSummary(this.env, String(inspectionId));
    }

    /** Up to 6 of one Summary finding's own photos, as JPEG with the long side at most 1568 px. */
    async findingPhotos(inspectionId: string, findingKey: string): Promise<DddPhoto[]> {
        const { readFindingPhotos } = await import('./summary');
        return readFindingPhotos(this.env, String(inspectionId), String(findingKey));
    }
}
