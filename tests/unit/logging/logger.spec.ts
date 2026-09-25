import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../server/lib/logger';

afterEach(() => vi.restoreAllMocks());

function loggedPayload() {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    return {
        info,
        read: () => JSON.parse(info.mock.calls[0][0] as string) as { data: Record<string, unknown> },
    };
}

describe('structured logger errors', () => {
    it('preserves caller-provided error data when no Error object is supplied', () => {
        const output = loggedPayload();
        logger.error('Delivery failed', { error: 'provider rejected request' });

        expect(output.read().data.error).toBe('provider rejected request');
    });

    it('redacts database parameters, email addresses, and credentials from exceptions', () => {
        const output = loggedPayload();
        const error = new Error('D1_ERROR\nparams: tenant-1, invitee@example.test\nAuthorization: Bearer secret-token');
        error.stack = `${error.message}\ntoken=join-secret`;

        logger.error('Unhandled application error', { method: 'POST' }, error);

        const serialized = JSON.stringify(output.read());
        expect(serialized).not.toContain('invitee@example.test');
        expect(serialized).not.toContain('secret-token');
        expect(serialized).not.toContain('join-secret');
        expect(serialized).toContain('[REDACTED]');
    });
});
