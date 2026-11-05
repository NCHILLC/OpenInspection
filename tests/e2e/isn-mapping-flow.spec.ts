import { test, expect } from '@playwright/test';
import { loginAsSeedUser, authedWriteHeaders } from './helpers/seed-login';
import { SEED_EMAILS } from '../seed-fixtures';

test('ISN mapping controls new imports and changes an existing template only through the explicit safe action', async ({ page }, testInfo) => {
    const reset = await page.request.post('http://127.0.0.1:8792/__test/reset');
    expect(reset.ok()).toBe(true);
    const orderNumber = String((await reset.json()).order.oid);
    await loginAsSeedUser(page, SEED_EMAILS.admin);
    const headers = await authedWriteHeaders(page);
    const created = await page.request.post('/api/inspections/templates', {
        headers,
        data: { name: 'ISN Mapped Primary', schema: { schemaVersion: 2, sections: [{ id: 'general', title: 'General', items: [{
            id: 'roof', label: 'Roof', type: 'rich', ratingOptions: ['Inspected', 'Repair'],
            tabs: { information: [], limitations: [], defects: [] },
        }] }] } },
    });
    expect(created.status(), await created.text()).toBe(201);
    const templateId = (await created.json()).data.template.id as string;

    await page.goto('/settings/advanced');
    const mappings = page.getByRole('region', { name: 'Primary report templates' });
    await expect(mappings.getByLabel('Home inspection', { exact: true })).toBeVisible();
    await mappings.getByLabel('Home inspection', { exact: true }).selectOption(templateId);
    await mappings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(mappings.getByRole('status')).toHaveText('Template mapping saved.');
    await page.screenshot({ path: testInfo.outputPath('isn-template-settings.png'), fullPage: true });

    const pull = await page.request.post('/api/integrations/isn/pull', { headers, data: {} });
    expect(pull.status(), await pull.text()).toBe(200);
    expect((await pull.json()).data.processed).toBe(1);
    const list = await page.request.get('/api/inspections', { headers });
    expect(list.ok()).toBe(true);
    const body = await list.json();
    const rows = Array.isArray(body.data) ? body.data : body.data.inspections;
    const inspection = rows.find((row: { propertyAddress?: string }) => row.propertyAddress?.startsWith(`${orderNumber} ISN Fixture Street`));
    expect(inspection).toBeTruthy();
    const detail = await page.request.get(`/api/inspections/${inspection.id}`, { headers });
    expect(detail.ok()).toBe(true);
    expect((await detail.json()).data.inspection).toMatchObject({ templateId, referenceNumber: orderNumber });

    const corrected = await page.request.post('/api/inspections/templates', {
        headers, data: { name: 'ISN Corrected Primary', schema: { schemaVersion: 2, sections: [{ id: 'corrected', title: 'Corrected section', items: [{
            id: 'roof', label: 'Roof', type: 'rich', ratingOptions: ['Inspected', 'Repair'], tabs: { information: [], limitations: [], defects: [] },
        }] }] } },
    });
    expect(corrected.status()).toBe(201);
    const correctedId = (await corrected.json()).data.template.id as string;
    const saveMapping = async (id: string) => {
        await page.goto('/settings/advanced');
        const section = page.getByRole('region', { name: 'Primary report templates' });
        await section.getByLabel('Home inspection', { exact: true }).selectOption(id);
        await section.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(section.getByRole('status')).toHaveText('Template mapping saved.');
    };
    await saveMapping(correctedId);
    const refresh = await page.request.post(`/api/inspections/${inspection.id}/isn/refresh`, { headers });
    expect(refresh.status()).toBe(200);
    const afterRefresh = await page.request.get(`/api/inspections/${inspection.id}`, { headers });
    expect((await afterRefresh.json()).data.inspection.templateId).toBe(templateId);
    await page.goto(`/inspections/${inspection.id}`);
    await page.getByRole('button', { name: 'Apply mapped template' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The report uses its mapped template.' })).toBeVisible();
    const afterApply = await page.request.get(`/api/inspections/${inspection.id}`, { headers });
    expect((await afterApply.json()).data.inspection.templateId).toBe(correctedId);
    const repeat = await page.request.post(`/api/inspections/${inspection.id}/isn/apply-template`, { headers });
    expect(repeat.status()).toBe(200);
    expect((await repeat.json()).changed).toBe(false);
    await page.goto(`/inspections/${inspection.id}/edit`);
    await expect(page.getByText('Corrected section', { exact: true }).first()).toBeVisible();
    await saveMapping(templateId);
    await page.goto(`/inspections/${inspection.id}`);
    await page.getByRole('button', { name: 'Apply mapped template' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The report has been opened' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('isn-template-refusal-mobile.png'), fullPage: true });
    const preserved = await page.request.get(`/api/inspections/${inspection.id}`, { headers });
    expect((await preserved.json()).data.inspection.templateId).toBe(correctedId);
});
