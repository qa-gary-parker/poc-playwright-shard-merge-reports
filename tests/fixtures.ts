import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ checklist: (...items: string[]) => Promise<Page> }>({
  checklist: async ({ page }, use) => {
    await use(async (...items) => {
      await page.goto('/');
      for (const item of items) {
        await page.getByLabel('New item').fill(item);
        await page.getByRole('button', { name: 'Add' }).click();
      }
      return page;
    });
  },
});
export { expect };
