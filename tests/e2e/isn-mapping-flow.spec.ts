import { test, expect } from '@playwright/test';
import { loginAsSeedUser, authedWriteHeaders } from './helpers/seed-login';
import { SEED_EMAILS } from '../seed-fixtures';

test('saving an ISN mapping selects the primary template for a new import', async ({ page }) => {
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

    const pull = await page.request.post('/api/integrations/isn/pull', { headers, data: {} });
    expect(pull.status(), await pull.text()).toBe(200);
    expect((await pull.json()).data.processed).toBe(1);
    const list = await page.request.get('/api/inspections', { headers });
    expect(list.ok()).toBe(true);
    const body = await list.json();
    const rows = Array.isArray(body.data) ? body.data : body.data.inspections;
    const inspection = rows.find((row: { referenceNumber?: string }) => row.referenceNumber === orderNumber);
    expect(inspection).toBeTruthy();
    const detail = await page.request.get(`/api/inspections/${inspection.id}`, { headers });
    expect(detail.ok()).toBe(true);
    expect((await detail.json()).data.inspection.templateId).toBe(templateId);
    await page.goto(`/inspections/${inspection.id}/edit`);
    await expect(page.getByText('General', { exact: true }).first()).toBeVisible();
});
