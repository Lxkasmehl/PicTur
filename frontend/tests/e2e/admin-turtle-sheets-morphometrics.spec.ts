import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
  registerKansasGeneralLocationsCatalogMock,
  pickKansasGeneralLocationInCreateTurtleDialog,
  selectSheetInCreateTurtleDialog,
  selectSexInCreateTurtleDialog,
  unlockUntilFieldEditable,
} from './fixtures';

/**
 * E2E tests: optional mass and morphometrics fields in the Create New Turtle form.
 * Fields (Mass (g), curved/straight carapace length, etc.) are visible and
 * submitted in turtle_data when filled.
 */

test.describe('Admin Create New Turtle – sheets morphometrics fields', () => {
  test.beforeEach(async ({ page }) => {
    await registerKansasGeneralLocationsCatalogMock(page);
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
    await page.route('**/api/locations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            locations: ['Kansas', 'Kansas/Wichita'],
          }),
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
    await registerKansasGeneralLocationsCatalogMock(page);
    await createBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create New Turtle' })).toBeVisible();

    await unlockUntilFieldEditable(page, dialog, 'DomeHeight');

    await expect(dialog.getByLabel('Mass (g)', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('CCL', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('DomeHeight', { exact: true })).toBeVisible();
  });

  test('Filled mass and morphometrics are sent in POST turtle_data', async ({ page }) => {
    test.setTimeout(90_000);

    const e2eRequestId = 'admin_e2e-morph-request-1';
    await page.route('**/upload', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            request_id: e2eRequestId,
            uploaded_image_path: '/e2e/morph-submit-e2e.png',
            matches: [],
            message: 'Uploaded',
          }),
        });
      } else {
        await route.continue();
      }
    });

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
          body: JSON.stringify({
            success: true,
            locations: ['Kansas', 'Kansas/Wichita'],
          }),
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
    await page.route('**/api/sheets/generate-primary-id', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, primary_id: 'E2E-MORPH-002' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/sheets/turtle', async (route) => {
      if (route.request().method() === 'POST') {
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

    await registerKansasGeneralLocationsCatalogMock(page);

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

    await registerKansasGeneralLocationsCatalogMock(page);
    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');
    await selectSexInCreateTurtleDialog(page, dialog, 'F');
    await pickKansasGeneralLocationInCreateTurtleDialog(page, dialog);

    await unlockUntilFieldEditable(page, dialog, 'Name');
    await dialog.getByLabel('Name', { exact: true }).fill('E2E Morph Turtle');
    await unlockUntilFieldEditable(page, dialog, 'DomeHeight');
    const massInput = dialog.getByLabel('Mass (g)', { exact: true });
    const domeHeightInput = dialog.getByLabel('DomeHeight', { exact: true });
    await massInput.fill('300');
    await domeHeightInput.fill('98');
    await expect(massInput).toHaveValue('300');
    await expect(domeHeightInput).toHaveValue('98');
    await domeHeightInput.press('Tab');

    const createTurtleDataBtn = dialog.getByRole('button', { name: 'Create Turtle Data' });
    await expect(createTurtleDataBtn).toBeEnabled({ timeout: 15_000 });

    const postResponsePromise = page.waitForResponse(
      (res) => res.url().includes('sheets/turtle') && res.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await createTurtleDataBtn.click();
    const postResponse = await postResponsePromise;
    const postBody = postResponse.request().postDataJSON() as {
      turtle_data?: { mass_g?: string; dome_height_mm?: string };
    };

    expect(postBody.turtle_data?.mass_g).toBe('300');
    expect(postBody.turtle_data?.dome_height_mm).toBe('98');
  });
});
