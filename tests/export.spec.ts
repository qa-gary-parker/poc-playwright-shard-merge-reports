import { test, expect } from './fixtures';

test('shows progress while exporting', async ({ checklist }) => {
  const page = await checklist('Freeze main');
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('Exporting...')).toBeVisible();
});

test('exports an empty checklist', async ({ checklist }) => {
  const page = await checklist();
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('Export ready: 0 items')).toBeVisible({ timeout: 10_000 });
});

test('exports every item', async ({ checklist }) => {
  const page = await checklist('Freeze main', 'Tag the release', 'Publish notes');
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('Export ready: 3 items')).toBeVisible({ timeout: 10_000 });
});

test('exports done items too', async ({ checklist }) => {
  const page = await checklist('Freeze main', 'Tag the release');
  await page.getByRole('checkbox', { name: 'Freeze main' }).check();
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('Export ready: 2 items')).toBeVisible({ timeout: 10_000 });
});
