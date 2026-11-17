import { test, expect } from './fixtures';

test('adds an item', async ({ checklist }) => {
  const page = await checklist('Tag the release');
  await expect(page.getByRole('listitem')).toHaveText(['Tag the release']);
});

test('adds items in order', async ({ checklist }) => {
  const page = await checklist('Freeze main', 'Tag the release', 'Publish notes');
  await expect(page.getByRole('listitem')).toHaveText(['Freeze main', 'Tag the release', 'Publish notes']);
});

test('clears the input after adding', async ({ checklist }) => {
  const page = await checklist('Freeze main');
  await expect(page.getByLabel('New item')).toHaveValue('');
});

test('does not add an empty item', async ({ checklist }) => {
  const page = await checklist();
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(0);
});
