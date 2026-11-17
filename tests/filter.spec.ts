import { test, expect } from './fixtures';

test.beforeEach(async ({ checklist }) => {
  const page = await checklist('Freeze main', 'Tag the release', 'Publish notes');
  await page.getByRole('checkbox', { name: 'Freeze main' }).check();
});

test('shows open items', async ({ page }) => {
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('listitem')).toHaveText(['Tag the release', 'Publish notes']);
});

test('shows done items', async ({ page }) => {
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('listitem')).toHaveText(['Freeze main']);
});

test('shows all items again', async ({ page }) => {
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
});

test('marks the active filter as pressed', async ({ page }) => {
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
});
