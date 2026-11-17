import { test, expect } from './fixtures';

test('marks an item done', async ({ checklist }) => {
  const page = await checklist('Freeze main');
  await page.getByRole('checkbox', { name: 'Freeze main' }).check();
  await expect(page.getByRole('checkbox', { name: 'Freeze main' })).toBeChecked();
});

test('marks an item open again', async ({ checklist }) => {
  const page = await checklist('Freeze main');
  const box = page.getByRole('checkbox', { name: 'Freeze main' });
  await box.check();
  await box.uncheck();
  await expect(box).not.toBeChecked();
});

test('only changes the item clicked', async ({ checklist }) => {
  const page = await checklist('Freeze main', 'Tag the release');
  await page.getByRole('checkbox', { name: 'Tag the release' }).check();
  await expect(page.getByRole('checkbox', { name: 'Freeze main' })).not.toBeChecked();
});
