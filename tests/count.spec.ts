import { test, expect } from './fixtures';

test('counts zero items', async ({ checklist }) => {
  const page = await checklist();
  await expect(page.getByText('0 open of 0')).toBeVisible();
});

test('counts open items', async ({ checklist }) => {
  const page = await checklist('Freeze main', 'Tag the release');
  await page.getByRole('checkbox', { name: 'Freeze main' }).check();
  await expect(page.getByText('1 open of 2')).toBeVisible();
});
