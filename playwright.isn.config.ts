import { defineConfig } from '@playwright/test';
import base from './playwright.config';

process.env.SEED_E2E = '1';

export default defineConfig({
    ...base,
    workers: 1,
    use: { ...base.use, baseURL: 'http://127.0.0.1:8791' },
    projects: [{ name: 'isn-mapping-flow', testMatch: 'isn-mapping-flow.spec.ts' }],
    webServer: [
        { command: 'node tests/helpers/isn-http-fixture.mjs', url: 'http://127.0.0.1:8792/health', reuseExistingServer: false },
        {
            command: 'npm run build && npx wrangler dev -c build/server/wrangler.json --persist-to .wrangler/state --port 8791 --var ENVIRONMENT:development --var DISABLE_RATE_LIMIT:1 --var APP_BASE_URL:http://127.0.0.1:8791 --var ISN_DOMAIN:http://127.0.0.1:8792 --var ISN_COMPANY_KEY:fixture --var ISN_ACCESS_KEY:fixture-access --var ISN_SECRET_KEY:fixture-secret --var ISN_WEBHOOK_SECRET:fixture-webhook',
            url: 'http://127.0.0.1:8791/status', timeout: 300000, reuseExistingServer: false,
        },
    ],
});
