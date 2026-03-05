import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
  selectSheetInCreateTurtleDialog,
  selectSexInCreateTurtleDialog,
} from './fixtures';

/**
 * E2E tests: optional mass and morphometrics fields in the Create New Turtle form.
 * Fields (Mass (g), curved/straight carapace length, etc.) are visible and
 * submitted in turtle_data when filled.
 */

test.describe('Admin Create New Turtle – sheets morphometrics fields', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await grantLocationPermission(page);
  });

  test('Create New Turtle dialog shows Mass (g) and morphometrics fields', async ({ page }) => {
    test.setTimeout(90_000);

    await page.route('**/api/sheets/turtle-names', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, names: [] }),
      });
    });
    await page.route('**/api/sheets/sheets**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sheets: ['Kansas'], success: true }),
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

    await loginAsAdmin(page);
    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'morph-e2e.png',
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

    await expect(dialog.getByLabel('Mass (g)', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Curved carapace length (mm)', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Dome height (mm)', { exact: true })).toBeVisible();
  });

  test('Filled mass and morphometrics are sent in POST turtle_data', async ({ page }) => {
    test.setTimeout(90_000);

    await page.route('**/api/sheets/turtle-names', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, names: [] }),
      });
    });
    await page.route('**/api/sheets/sheets**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sheets: ['Kansas'], success: true }),
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
          body: JSON.stringify({ success: true, id: 'F2' }),
        });
      } else {
        await route.continue();
      }
    });

    let postBody: { turtle_data?: { mass_g?: string; dome_height_mm?: string } } = {};
    await page.route('**/api/sheets/turtle', async (route) => {
      if (route.request().method() === 'POST') {
        postBody = route.request().postDataJSON() || {};
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            primary_id: 'E2E-MORPH-002',
            id: 'F2',
            message: 'Turtle data created successfully',
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'morph-submit-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');
    await selectSexInCreateTurtleDialog(page, dialog, 'F');

    await dialog.getByLabel('Name', { exact: true }).fill('E2E Morph Turtle');
    await dialog.getByLabel('Mass (g)', { exact: true }).fill('300');
    await dialog.getByLabel('Dome height (mm)', { exact: true }).fill('98');

    await dialog.getByRole('button', { name: 'Create Turtle Data' }).click();

    await expect(page.getByText(/created|success/i)).toBeVisible({ timeout: 10_000 }).catch(() => {});

    expect(postBody.turtle_data?.mass_g).toBe('300');
    expect(postBody.turtle_data?.dome_height_mm).toBe('98');
  });
});
