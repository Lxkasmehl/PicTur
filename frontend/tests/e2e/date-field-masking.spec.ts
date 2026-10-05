import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
  unlockUntilFieldEditable,
} from './fixtures';

/**
 * E2E tests for the live-typing date input mask (auto-inserted slashes / MM/DD/YYYY)
 * on the Create New Turtle form. Covers:
 *  - single-date fields ("Date 1st found")
 *  - comma-separated multi-date fields ("Dates refound")
 *  - mixed date-or-text fields ("Date DNA Extracted?")
 *  - the cursor staying in the right place across re-masking, so a typo can be
 *    fixed in place instead of getting pushed to the end of the field.
 */
test.describe('Date field input mask (Create New Turtle)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await grantLocationPermission(page);

    await page.route('**/api/sheets/turtle-names', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, names: [] }),
      });
    });
    await page.route('**/api/locations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, locations: ['Kansas', 'Kansas/Wichita'] }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/sheets/generate-id', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, id: 'F1' }),
        });
      } else {
        await route.continue();
      }
    });
  });

  async function openCreateTurtleDialog(page: import('@playwright/test').Page) {
    await loginAsAdmin(page);
    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'date-mask-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    const createBtn = page.getByRole('button', { name: 'Create New Turtle' });
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await createBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create New Turtle' })).toBeVisible();
    return dialog;
  }

  test('single-date field auto-inserts slashes while typing (MM/DD/YYYY)', async ({ page }) => {
    test.setTimeout(90_000);
    const dialog = await openCreateTurtleDialog(page);

    await unlockUntilFieldEditable(page, dialog, 'Date 1st found');
    const dateInput = dialog.getByLabel('Date 1st found', { exact: true });
    await dateInput.click();
    await dateInput.pressSequentially('01272026', { delay: 20 });

    await expect(dateInput).toHaveValue('01/27/2026');
  });

  test('multi-date field auto-inserts slashes and commas while typing', async ({ page }) => {
    test.setTimeout(90_000);
    const dialog = await openCreateTurtleDialog(page);

    await unlockUntilFieldEditable(page, dialog, 'Dates refound');
    const datesRefoundInput = dialog.getByLabel('Dates refound', { exact: true });
    await datesRefoundInput.click();
    await datesRefoundInput.pressSequentially('06152021,07042022', { delay: 20 });

    await expect(datesRefoundInput).toHaveValue('06/15/2021, 07/04/2022');
  });

  test('mixed date-or-text field masks digits but leaves words like "Yes" untouched', async ({ page }) => {
    test.setTimeout(90_000);
    const dialog = await openCreateTurtleDialog(page);

    await unlockUntilFieldEditable(page, dialog, 'Date DNA Extracted?');
    const dnaInput = dialog.getByLabel('Date DNA Extracted?', { exact: true });
    await dnaInput.click();
    await dnaInput.pressSequentially('Yes', { delay: 20 });
    await expect(dnaInput).toHaveValue('Yes');

    await dnaInput.fill('');
    await dnaInput.pressSequentially('01152024', { delay: 20 });
    await expect(dnaInput).toHaveValue('01/15/2024');
  });

  test('typing a character right after a comma continues the next date (caret does not stay left of the comma)', async ({ page }) => {
    test.setTimeout(90_000);
    const dialog = await openCreateTurtleDialog(page);

    await unlockUntilFieldEditable(page, dialog, 'Dates refound');
    const datesRefoundInput = dialog.getByLabel('Dates refound', { exact: true });
    await datesRefoundInput.click();
    // Type a short first date, a comma, then immediately the next digit.
    // If the caret were stuck to the left of the comma (the reported bug), the
    // "3" below would land inside the first date instead of starting the next one.
    await datesRefoundInput.pressSequentially('0127,3', { delay: 20 });

    await expect(datesRefoundInput).toHaveValue('01/27, 3');
  });

  test('fixing a typo in an earlier date after typing a comma does not corrupt later dates (cursor stays in place across re-masking)', async ({ page }) => {
    test.setTimeout(90_000);
    const dialog = await openCreateTurtleDialog(page);

    await unlockUntilFieldEditable(page, dialog, 'Dates refound');
    const datesRefoundInput = dialog.getByLabel('Dates refound', { exact: true });
    await datesRefoundInput.click();

    // Type two full dates with a typo in the first year (2921 instead of 2021).
    await datesRefoundInput.pressSequentially('06152921,07042022', { delay: 20 });
    await expect(datesRefoundInput).toHaveValue('06/15/2921, 07/04/2022');

    // Navigate back (from the end) to right after the typo'd "9" and fix it in place.
    // "06/15/2921, 07/04/2022" — the "9" sits 14 characters before the end.
    for (let i = 0; i < 14; i += 1) {
      await datesRefoundInput.press('ArrowLeft');
    }
    await datesRefoundInput.press('Backspace');
    await datesRefoundInput.press('0');

    // If the caret jumped to the end after re-masking (the old, buggy behavior),
    // the "0" would land after "2022" instead of fixing the first date's year.
    await expect(datesRefoundInput).toHaveValue('06/15/2021, 07/04/2022');
  });
});
