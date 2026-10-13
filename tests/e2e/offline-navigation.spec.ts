/**
 * Offline navigation inside the editor (QA sweep 2026-09-24, NET-01).
 *
 * Offline, opening an editor section or item the page had not visited yet
 * replaced the whole editor with the root error boundary ("Something went
 * wrong"), and Back reloaded the same dead screen. React Router's default lazy
 * route discovery asks the server `GET /__manifest?paths=…` before it will go to
 * a path it has not seen, and a rejected fetch there is thrown as a route error.
 *
 * Field editing offline is the documented promise of this editor (the Yjs
 * results document buffers the edits), so a tap must not need the server just to
 * learn which routes exist. `react-router.config.ts` ships the whole manifest
 * with the first document instead (`routeDiscovery: { mode: "initial" }`).
 *
 * Two assertions, because they fail differently:
 *   - the visible outcome: the item pane opens and no error screen appears;
 *   - the cause: no `/__manifest` request is attempted at all, offline or not.
 *
 * Run: npx playwright test --project=mobile-nav
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';
import { ADMIN_EMAIL, ADMIN_PASSWORD, COMPANY_NAME } from './helpers/tenant-identity';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 15000;

const SECTION_A = { id: 'sec_roof', title: 'Roof Structure' };
const SECTION_B = { id: 'sec_plumbing', title: 'Plumbing Supply' };
const ITEM_B1 = { id: 'itm_water_heater', label: 'Water Heater' };

const richItem = (id: string, label: string) => ({
    id,
    label,
    type: 'rich',
    ratingOptions: ['Inspected', 'Repair'],
    tabs: { information: [], limitations: [], defects: [] },
});

async function login(request: APIRequestContext): Promise<string> {
    const csrf = makeCsrfToken();
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `__Host-csrf_token=${csrf}` },
    });
    expect(res.status()).toBe(200);
    return (res.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1] ?? '';
}

const shell = (page: Page) => page.locator('[data-testid="mobile-drill"]');

test.describe.serial('Editor navigation with the network gone', () => {
    let token = '';
    let inspectionId = '';

    test('SETUP: an inspection with two sections', async ({ request }) => {
        const csrf = makeCsrfToken();
        // 409 once the workspace exists is the expected, harmless answer.
        await request.post(`${BASE_URL}/api/auth/setup`, {
            data: { companyName: COMPANY_NAME, adminName: 'Test Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, verificationCode: '000000' },
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `__Host-csrf_token=${csrf}` },
        });
        token = await login(request);
        const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

        const tpl = await request.post(`${BASE_URL}/api/inspections/templates`, {
            data: {
                name: 'Offline Nav Template',
                schema: {
                    schemaVersion: 2,
                    sections: [
                        { id: SECTION_A.id, title: SECTION_A.title, items: [richItem('itm_shingles', 'Shingles')] },
                        { id: SECTION_B.id, title: SECTION_B.title, items: [richItem(ITEM_B1.id, ITEM_B1.label)] },
                    ],
                },
            },
            headers: auth,
        });
        const templateId = (await tpl.json()).data?.template?.id;
        expect(templateId, 'template created').toBeTruthy();

        const ins = await request.post(`${BASE_URL}/api/inspections`, {
            data: { propertyAddress: '14 Offline Way', clientName: 'Offline Tester', clientEmail: 'offline@autotest.com', templateId },
            headers: auth,
        });
        const body = await ins.json();
        inspectionId = body.data?.inspection?.id ?? body.data?.id;
        expect(inspectionId, 'inspection created').toBeTruthy();
    });

    test('a section and an item never opened this session still open offline', async ({ page, context }) => {
        await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
        await page.setViewportSize({ width: 375, height: 812 });

        const manifestRequests: string[] = [];
        page.on('request', (r) => {
            if (new URL(r.url()).pathname.endsWith('/__manifest')) manifestRequests.push(r.url());
        });

        await page.goto(`${BASE_URL}/inspections/${inspectionId}/edit`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
        await expect(shell(page)).toHaveAttribute('data-level', 'sections', { timeout: NAV_TIMEOUT });

        await context.setOffline(true);

        await page.getByText(SECTION_B.title, { exact: false }).first().click();
        await expect(shell(page)).toHaveAttribute('data-level', 'items', { timeout: NAV_TIMEOUT });
        await page.getByText(ITEM_B1.label, { exact: false }).first().click();
        await expect(shell(page)).toHaveAttribute('data-level', 'item', { timeout: NAV_TIMEOUT });

        await expect(page.getByText('Something went wrong')).toHaveCount(0);
        expect(manifestRequests, 'route discovery asked the server which routes exist').toEqual([]);
    });
});
