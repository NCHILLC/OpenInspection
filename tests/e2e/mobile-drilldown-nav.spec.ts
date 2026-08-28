/**
 * Phone report writer — drill-down navigation.
 *
 * The stack (sections → items → item detail) lives in `?section=`/`?item=`
 * rather than component state, and these are the three things that buys. Each
 * one is invisible to a unit test because each is a property of real history:
 *
 *   BACK      Android's hardware back walks up the stack instead of leaving
 *             the inspection. This is the button people actually press.
 *   DEEP LINK One item is addressable, cold, with no prior in-app history.
 *   RELOAD    The page comes back where the inspector was. Launching the
 *             camera backgrounds the browser and a phone under memory pressure
 *             discards the page while it is there — this is that recovery.
 *
 * Run: npx playwright test --project=mobile-nav
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';
import { COMPANY_NAME } from './helpers/tenant-identity';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 15000;
const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';

const SECTION_A = { id: 'sec_roof', title: 'Roof Structure' };
const SECTION_B = { id: 'sec_plumbing', title: 'Plumbing Supply' };
const ITEM_B1 = { id: 'itm_water_heater', label: 'Water Heater' };

async function loginApi(request: APIRequestContext): Promise<string> {
    const csrf = makeCsrfToken();
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
            Cookie: `__Host-csrf_token=${csrf}`,
        },
    });
    expect(res.status()).toBe(200);
    const match = (res.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/);
    return match?.[1] ?? '';
}

async function gotoMobile(page: Page, path: string, token: string) {
    await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE_URL}${path}`, { timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
}

/** The shell stamps which screen is showing; see MobileDrillShell. */
const shell = (page: Page) => page.locator('[data-testid="mobile-drill"]');
const expectLevel = async (page: Page, level: 'sections' | 'items' | 'item') =>
    expect(shell(page)).toHaveAttribute('data-level', level, { timeout: NAV_TIMEOUT });

test.describe.serial('Phone drill-down navigation', () => {
    let adminToken = '';
    let inspectionId = '';

    test('SETUP: an inspection with two sections to walk between', async ({ request }) => {
        const csrf = makeCsrfToken();
        await request.post(`${BASE_URL}/api/auth/setup`, {
            data: {
                companyName: COMPANY_NAME,
                adminName: 'Test Admin',
                email: ADMIN_EMAIL,
                password: ADMIN_PASSWORD,
                verificationCode: '000000',
            },
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: `__Host-csrf_token=${csrf}` },
        });
        adminToken = await loginApi(request);

        // A dedicated template: the stack is only meaningfully walkable with two
        // sections, and the shared fixture has one.
        const tplRes = await request.post(`${BASE_URL}/api/inspections/templates`, {
            data: {
                name: 'Drilldown Nav Template',
                schema: {
                    schemaVersion: 2,
                    sections: [
                        {
                            id: SECTION_A.id,
                            title: SECTION_A.title,
                            items: [
                                { id: 'itm_shingles', label: 'Shingles', type: 'rich', ratingOptions: ['Inspected', 'Repair'], tabs: { information: [], limitations: [], defects: [] } },
                            ],
                        },
                        {
                            id: SECTION_B.id,
                            title: SECTION_B.title,
                            items: [
                                { id: ITEM_B1.id, label: ITEM_B1.label, type: 'rich', ratingOptions: ['Inspected', 'Repair'], tabs: { information: [], limitations: [], defects: [] } },
                            ],
                        },
                    ],
                },
            },
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        });
        const tplId = (await tplRes.json()).data?.template?.id;
        expect(tplId, 'template created').toBeTruthy();

        const insRes = await request.post(`${BASE_URL}/api/inspections`, {
            data: {
                propertyAddress: '1132 Mt Holly-Huntersville Rd',
                clientName: 'Drilldown Tester',
                clientEmail: 'drilldown@autotest.com',
                templateId: tplId,
            },
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        });
        inspectionId = (await insRes.json()).data?.inspection?.id ?? (await insRes.json()).data?.id;
        expect(inspectionId, 'inspection created').toBeTruthy();
    });

    test('opens on the section list, with no drill-down params', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit`, adminToken);
        await expectLevel(page, 'sections');
        expect(new URL(page.url()).searchParams.get('section')).toBeNull();
    });

    test('walks down into a section, then into an item, stamping the URL', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit`, adminToken);
        await expectLevel(page, 'sections');

        await page.getByText(SECTION_B.title, { exact: false }).first().click();
        await expectLevel(page, 'items');
        expect(new URL(page.url()).searchParams.get('section')).toBe(SECTION_B.id);
        expect(new URL(page.url()).searchParams.get('item')).toBeNull();

        await page.getByText(ITEM_B1.label, { exact: false }).first().click();
        await expectLevel(page, 'item');
        expect(new URL(page.url()).searchParams.get('item')).toBe(ITEM_B1.id);
    });

    // The reason the stack is in the URL at all.
    test('BACK walks up one level at a time instead of leaving the inspection', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit`, adminToken);
        await page.getByText(SECTION_B.title, { exact: false }).first().click();
        await expectLevel(page, 'items');
        await page.getByText(ITEM_B1.label, { exact: false }).first().click();
        await expectLevel(page, 'item');

        await page.goBack();
        await expectLevel(page, 'items');
        expect(new URL(page.url()).searchParams.get('item')).toBeNull();
        expect(new URL(page.url()).searchParams.get('section')).toBe(SECTION_B.id);

        await page.goBack();
        await expectLevel(page, 'sections');
        expect(new URL(page.url()).searchParams.get('section')).toBeNull();
        // Still inside the editor — back did not walk off the inspection.
        expect(page.url()).toContain(`/inspections/${inspectionId}/edit`);
    });

    test('a cold deep link opens straight to the item', async ({ page }) => {
        await gotoMobile(
            page,
            `/inspections/${inspectionId}/edit?section=${SECTION_B.id}&item=${ITEM_B1.id}`,
            adminToken,
        );
        await expectLevel(page, 'item');
        await expect(page.getByText(ITEM_B1.label, { exact: false }).first()).toBeVisible();
    });

    // The camera-eviction recovery: same URL, fresh page, same place.
    test('a reload lands back on the same item', async ({ page }) => {
        await gotoMobile(
            page,
            `/inspections/${inspectionId}/edit?section=${SECTION_B.id}&item=${ITEM_B1.id}`,
            adminToken,
        );
        await expectLevel(page, 'item');

        await page.reload({ timeout: NAV_TIMEOUT, waitUntil: 'networkidle' });
        await expectLevel(page, 'item');
        expect(new URL(page.url()).searchParams.get('item')).toBe(ITEM_B1.id);
    });

    // `shouldRevalidate` refuses to refetch for section/item-only diffs. Without
    // it every tap re-runs the inspection loader — a round trip per tap, in the
    // crawlspaces where there is no signal to serve one.
    test('drilling down does NOT refetch the route loader', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit`, adminToken);
        await expectLevel(page, 'sections');

        const loaderCalls: string[] = [];
        page.on('request', (req) => {
            const u = new URL(req.url());
            // A React Router loader revalidation is a GET on the same path
            // carrying the _routes/.data marker.
            if (u.pathname.includes(`/inspections/${inspectionId}/edit`) && (u.searchParams.has('_routes') || u.pathname.endsWith('.data'))) {
                loaderCalls.push(req.url());
            }
        });

        await page.getByText(SECTION_B.title, { exact: false }).first().click();
        await expectLevel(page, 'items');
        await page.getByText(ITEM_B1.label, { exact: false }).first().click();
        await expectLevel(page, 'item');

        expect(loaderCalls, `drill-down refetched the loader: ${loaderCalls.join(', ')}`).toHaveLength(0);
    });
});
