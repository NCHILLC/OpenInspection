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

    /**
     * The 2026-09-06 eval logged the shutter dropping 1-2 of 5 rapid TAPS while
     * mouse clicks never dropped once. On a zoomable viewport a touch browser
     * holds each tap ~300ms to see whether it becomes a double-tap zoom, and a
     * tap landing inside that window is consumed BY the gesture — no click is
     * dispatched at all. Not delayed, discarded. The opt-out leaves pinch zoom
     * (and WCAG 1.4.4) intact.
     *
     * Asserted as COMPUTED STYLE because the rule is global and unlayered in
     * tailwind.css: a future Tailwind relayering could swallow it silently, and
     * the symptom would be lost photos in a crawlspace, not a build error.
     *
     * This does NOT prove taps stop dropping — a synthetic touch never runs the
     * browser's real double-tap heuristic. It proves the opt-out reaches the
     * controls. The behaviour itself needs a handset.
     */
    test('tappable controls opt out of double-tap zoom', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit`, adminToken);
        await expectLevel(page, 'sections');

        const touchAction = await page.locator('button').first().evaluate(
            (el) => getComputedStyle(el).touchAction,
        );
        expect(touchAction, 'a button still allows double-tap zoom, which eats rapid taps')
            .toBe('manipulation');
    });

    test('checklist rates in place, opens details, and retains the answer after reload', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit?section=${SECTION_B.id}`, adminToken);
        await expectLevel(page, 'items');
        const row = page.getByRole('article', { name: ITEM_B1.label });
        await expect(row.getByRole('radiogroup', { name: `Rate ${ITEM_B1.label}` })).toBeVisible();
        const rating = row.getByRole('radio').first();
        const ratingName = await rating.getAttribute('aria-label');
        await rating.click();
        await expect(rating).toHaveAttribute('aria-checked', 'true');
        await expectLevel(page, 'items');
        await expect(page.getByTestId('checklist-summary')).toContainText('1 of 1 rated');
        await page.reload({ waitUntil: 'networkidle' });
        await expect(row.getByRole('radio', { name: ratingName!, exact: true })).toHaveAttribute('aria-checked', 'true');
        await row.getByRole('button', { name: `Open details — ${ITEM_B1.label}` }).click();
        await expectLevel(page, 'item');
        await page.goBack();
        await expectLevel(page, 'items');
    });

    test('checklist camera attaches a library photo to its row with no active item', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit?section=${SECTION_B.id}`, adminToken);
        await expectLevel(page, 'items');
        expect(new URL(page.url()).searchParams.get('item')).toBeNull();
        const row = page.getByRole('article', { name: ITEM_B1.label });
        const photo = row.getByRole('button', { name: `Add photo — ${ITEM_B1.label}` });
        await photo.click();
        await expect(page.getByRole('dialog', { name: 'Add media' })).toBeVisible();
        const fileChooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Add from library' }).click();
        const chooser = await fileChooser;
        // A real, decodable image exercises preprocessing and the normal upload path.
        const png = await page.evaluate(async () => {
            const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
            canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
            return Array.from(new Uint8Array(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer()));
        });
        await chooser.setFiles({ name: 'checklist.png', mimeType: 'image/png', buffer: Buffer.from(png) });
        await expect(photo).toContainText('1', { timeout: NAV_TIMEOUT });
        await expectLevel(page, 'items');
        await page.reload({ waitUntil: 'networkidle' });
        await expect(photo).toContainText('1');
        await expect(page.getByTestId('checklist-summary')).toContainText('1 photo');
        // Denied in-app camera falls back to the native picker without losing its row target.
        await page.evaluate(() => {
            navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Test camera denial', 'NotAllowedError'));
        });
        await photo.click();
        const nativeChooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Take photo', exact: true }).click();
        await (await nativeChooser).setFiles({ name: 'native.png', mimeType: 'image/png', buffer: Buffer.from(png) });
        await expect(photo).toContainText('2', { timeout: NAV_TIMEOUT });
        await page.reload({ waitUntil: 'networkidle' });
        await expect(photo).toContainText('2');
        await expectLevel(page, 'items');
    });

    test('checklist controls fit narrow phones in Field and Sun themes', async ({ page }) => {
        await gotoMobile(page, `/inspections/${inspectionId}/edit?section=${SECTION_B.id}`, adminToken);
        for (const theme of ['field', 'sun']) {
            await page.evaluate(t => document.documentElement.setAttribute('data-color-scheme', t), theme);
            for (const width of [320, 375, 412]) {
                await page.setViewportSize({ width, height: 915 });
                const row = page.getByRole('article', { name: ITEM_B1.label });
                await expect(row).toBeVisible();
                expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
                for (const control of await row.locator('button').all()) {
                    const bounds = await control.boundingBox();
                    expect(bounds?.height).toBeGreaterThanOrEqual(48);
                    if (await control.getAttribute('role') === 'radio') expect(bounds?.width).toBeGreaterThanOrEqual(48);
                    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
                }
                const preview = await page.getByRole('button', { name: 'Preview', exact: true }).first().boundingBox();
                const next = await page.getByTestId('mobile-next-item').boundingBox();
                expect(preview!.x + preview!.width).toBeLessThanOrEqual(next!.x);
                await page.screenshot({ path: `test-results/checklist-${theme}-${width}.png`, fullPage: true });
            }
        }
    });
});
