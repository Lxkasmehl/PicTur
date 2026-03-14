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
 * E2E tests: auto-generated ID field (biology ID) in the Create New Turtle form.
 * ID is generated from gender (M/F/J/U) + next sequence number for the sheet;
 * no manual entry required.
 */

const MOCK_BIOLOGY_ID = 'F42';

test.describe('Admin Create New Turtle – auto-generated ID field', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await grantLocationPermission(page);
  });

  test('ID field shows auto-generated value (gender + sequence) and is disabled', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // Mock generate-id so the form gets a predictable biology ID preview (match any base URL)
    await page.route('**/sheets/generate-id', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, id: MOCK_BIOLOGY_ID }),
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

    // Create New Turtle uses useBackendLocations and GET /api/locations.
    // Mock backend paths (State or State/Location); test selects "Kansas".
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

    await loginAsAdmin(page);
    await page
      .getByText('Successfully logged in!')
      .waitFor({ state: 'hidden', timeout: 8000 })
      .catch(() => {});

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'id-auto-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });

    const createBtn = page.getByRole('button', { name: 'Create New Turtle' });
    await expect(createBtn).toBeVisible({ timeout: 15_000 });

    const locationsResponse = page.waitForResponse(
      (resp) => resp.url().includes('/api/locations') && resp.status() === 200,
      { timeout: 15_000 },
    );
    await createBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create New Turtle' })).toBeVisible();
    await locationsResponse;

    // Wait for generate-id request so we know the app requested an ID before asserting the field
    const generateIdResponse = page.waitForResponse(
      (resp) => resp.url().includes('generate-id') && resp.status() === 200,
      { timeout: 20_000 },
    );

    // Select sheet (Kansas) then sex (F) – this triggers generate-id in the app
    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');
    await selectSexInCreateTurtleDialog(page, dialog, 'F');
    await generateIdResponse;

    // Wait for UI outcome: ID field shows auto-generated value and is disabled
    const idField = dialog.getByLabel('ID', { exact: true });
    await expect(idField).toHaveValue(MOCK_BIOLOGY_ID, { timeout: 15_000 });
    await expect(idField).toBeDisabled();

    // Create mode: ID description explains auto-generation (branch: ID always read-only)
    await expect(
      dialog.getByText('Auto-generated from sex + sequence for this sheet (e.g. M1, F2)'),
    ).toBeVisible();
  });

  test('ID preview updates when sex changes (M -> F)', async ({ page }) => {
    test.setTimeout(90_000);

    let callCount = 0;
    await page.route('**/api/sheets/generate-id', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      callCount += 1;
      // First call: M, second call: F
      const body = JSON.parse(route.request().postData() || '{}');
      const sex = (body.sex || 'U').toUpperCase();
      const id = sex === 'M' ? 'M1' : 'F99';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, id }),
      });
    });

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

    // Mock backend location paths (State or State/Location) so dropdown has Kansas
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

    await loginAsAdmin(page);
    await page
      .getByText('Successfully logged in!')
      .waitFor({ state: 'hidden', timeout: 8000 })
      .catch(() => {});

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'id-preview-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    const locationsResponse = page.waitForResponse(
      (resp) => resp.url().includes('/api/locations') && resp.status() === 200,
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await locationsResponse;

    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');

    await selectSexInCreateTurtleDialog(page, dialog, 'M');

    const idField = dialog.getByLabel('ID', { exact: true });
    await expect(idField).toHaveValue('M1', { timeout: 5000 });

    await selectSexInCreateTurtleDialog(page, dialog, 'F');

    await expect(idField).toHaveValue('F99', { timeout: 5000 });
  });
});
