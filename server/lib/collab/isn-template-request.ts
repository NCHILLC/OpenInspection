import type * as Y from 'yjs';
import { drizzle } from 'drizzle-orm/d1';
import { AppError } from '../errors';
import { applyIsnTemplate } from '../../services/isn/template-application';

/** The caller gates incoming sockets/messages with blockConcurrencyWhile. */
export async function handleIsnTemplateRequest(req: Request, db: D1Database, state: DurableObjectState, doc: Y.Doc): Promise<Response> {
    const tenantId = req.headers.get('x-tenant-id');
    const inspectionId = req.headers.get('x-inspection-id');
    const reportId = req.headers.get('x-report-id');
    if (!tenantId || !inspectionId || !reportId) return new Response('Missing report identity', { status: 400 });
    // Identity is persisted before the first socket is accepted. Checking it
    // also protects an opened-but-not-yet-flushed document and offline edits.
    const stored = await state.storage.get(['identity', 'ydoc']);
    const opened = state.getWebSockets().length > 0 || stored.size > 0 || doc.getMap('results').size > 0;
    try {
        const result = await applyIsnTemplate(drizzle(db), tenantId, inspectionId, reportId, opened);
        return Response.json({ success: true, ...result });
    } catch (error) {
        if (error instanceof AppError) return Response.json({ success: false, error: { message: error.message } }, { status: error.status });
        // Never let an unreadable result blob turn into a destructive best guess.
        return Response.json({ success: false, error: { message: 'The report state could not be checked. No template was changed. Try again.' } }, { status: 503 });
    }
}
