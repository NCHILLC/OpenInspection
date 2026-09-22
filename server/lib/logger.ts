enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

interface LogContext {
    tenantId?: string;
    userId?: string;
    path?: string;
    method?: string;
    [key: string]: unknown;
}

function sanitizeErrorText(value: string | undefined): string | undefined {
    return value
        ?.replace(/(^|\n)(\s*params?:)\s*[^\n]*/gi, '$1$2 [REDACTED]')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
        .replace(/\b(authorization\s*:\s*bearer|bearer)\s+[^\s,;]+/gi, '$1 [REDACTED]')
        .replace(/\b((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

/**
 * Structured Logger for Cloudflare Workers.
 * Outputs JSON for easy ingestion by log aggregators.
 */
class Logger {
    constructor(private context: LogContext = {}) {}

    /**
     * Creates a child logger with additional context.
     */
    child(additionalContext: LogContext): Logger {
        return new Logger({ ...this.context, ...additionalContext });
    }

    private log(level: LogLevel, message: string, data?: unknown) {
        const payload = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...this.context,
            ...(data ? { data } : {}),
        };

        // Cloudflare Workers console.log handles objects by stringifying them
        // In production, we want a single line JSON string for aggregators.
        console.info(JSON.stringify(payload));
    }

    debug(message: string, data?: unknown) {
        this.log(LogLevel.DEBUG, message, data);
    }

    info(message: string, data?: unknown) {
        this.log(LogLevel.INFO, message, data);
    }

    warn(message: string, data?: unknown) {
        this.log(LogLevel.WARN, message, data);
    }

    error(message: string, data?: Record<string, unknown>, error?: Error) {
        this.log(LogLevel.ERROR, message, {
            ...(data || {}),
            ...(error ? {
                error: {
                    message: sanitizeErrorText(error.message),
                    stack: sanitizeErrorText(error.stack),
                },
            } : {}),
        });
    }
}

// Default singleton instance
export const logger = new Logger();
