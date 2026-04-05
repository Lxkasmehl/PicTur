import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
  selectSheetInCreateTurtleDialog,
  registerKansasGeneralLocationsCatalogMock,
  pickKansasGeneralLocationInCreateTurtleDialog,
  unlockUntilFieldEditable,
} from './fixtures';

/**
 * E2E tests: duplicate turtle name validation in the Create New Turtle form.
 * The WebApp must not allow a new turtle name that already exists in the Master
 * Google Spreadsheet (across any location sheet).
 */

const MOCK_EXISTING_NAMES = [
  { name: 'Master Oogway', primary_id: 'K001' },
  { name: "Leonardo", primary_id: 'T042' },
];

test.describe('Admin Create New Turtle – duplicate name validation', () => {
  test.beforeEach(async ({ page }) => {
    await registerKansasGeneralLocationsCatalogMock(page);
    await page.goto('/');
    await grantLocationPermission(page);
  });

  test('Duplicate turtle name shows error and blocks submit', async ({ page }) => {
    test.setTimeout(90_000);

    // Mock turtle-names so the form sees "Master Oogway" as already existing
    await page.route('**/api/sheets/turtle-names', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          names: MOCK_EXISTING_NAMES,
        }),
      });
    });

    // Mock list sheets so the Create New Turtle form has a sheet to select
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

    // Create New Turtle (admin) uses GET /api/locations for Sheet/Location dropdown
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

    await registerKansasGeneralLocationsCatalogMock(page);

    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'duplicate-name-e2e.png',
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
    // Wait for turtle-names request that fires when the form mounts (before we click)
    const turtleNamesResponse = page.waitForResponse(
      (resp) => resp.url().includes('turtle-names') && resp.status() === 200,
      { timeout: 15_000 },
    );
    await createBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create New Turtle' })).toBeVisible();
    await turtleNamesResponse;

    // Select sheet and General Location (required for admin create)
    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');
    await pickKansasGeneralLocationInCreateTurtleDialog(page, dialog);

    await unlockUntilFieldEditable(page, dialog, 'Name');
    // Fill Name with an existing name (case-insensitive match)
    const nameInput = dialog.getByLabel('Name', { exact: true });
    await nameInput.fill('Master Oogway');
    await nameInput.blur();

    // Form validates on blur: duplicate name must show error
    await expect(dialog.getByText('This name is already used by another turtle')).toBeVisible({
      timeout: 5000,
    });

    // Submit should be blocked by validation and show notification
    await dialog.getByRole('button', { name: 'Create Turtle Data' }).click();
    await expect(page.getByText('Please fix the errors in the form')).toBeVisible({
      timeout: 5000,
    });
    await expect(dialog).toBeVisible();
  });

  test('Duplicate name (different casing) is still rejected', async ({ page }) => {
    test.setTimeout(90_000);

    await page.route('**/api/sheets/turtle-names', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          names: MOCK_EXISTING_NAMES,
        }),
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

    await registerKansasGeneralLocationsCatalogMock(page);

    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'duplicate-casing-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    const turtleNamesResponse = page.waitForResponse(
      (resp) => resp.url().includes('turtle-names') && resp.status() === 200,
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await turtleNamesResponse;

    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');
    await pickKansasGeneralLocationInCreateTurtleDialog(page, dialog);

    await unlockUntilFieldEditable(page, dialog, 'Name');
    // Different casing than stored "Leonardo" – should still be treated as duplicate
    const nameInput = dialog.getByLabel('Name', { exact: true });
    await nameInput.fill('leonardo');
    await nameInput.blur();

    await expect(dialog.getByText('This name is already used by another turtle')).toBeVisible({
      timeout: 5000,
    });
  });

  test('Unique name does not show duplicate error', async ({ page }) => {
    test.setTimeout(90_000);

    await page.route('**/api/sheets/turtle-names', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          names: MOCK_EXISTING_NAMES,
        }),
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

    await registerKansasGeneralLocationsCatalogMock(page);

    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'unique-name-e2e.png',
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
    await pickKansasGeneralLocationInCreateTurtleDialog(page, dialog);

    await unlockUntilFieldEditable(page, dialog, 'Name');
    const nameInput = dialog.getByLabel('Name', { exact: true });
    await nameInput.fill('E2E Unique Turtle Name 999');
    await nameInput.dispatchEvent('blur');

    // No duplicate error should appear
    await expect(dialog.getByText('This name is already used by another turtle')).not.toBeVisible();
  });

  test('Submit is blocked until turtle names are loaded (no bypass)', async ({ page }) => {
    test.setTimeout(90_000);

    // Delay turtle-names so we can assert loading state and that submit is blocked before load
    await page.route('**/api/sheets/turtle-names', async (route) => {
      await new Promise((r) => setTimeout(r, 5000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          names: MOCK_EXISTING_NAMES,
        }),
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

    await registerKansasGeneralLocationsCatalogMock(page);

    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'loading-names-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create New Turtle' })).toBeVisible();

    // Button must stay disabled while names load. One assertion avoids a race where the delayed
    // response completes between a separate toBeVisible and toBeDisabled.
    await expect(dialog.getByRole('button', { name: /Loading names/ })).toBeDisabled({
      timeout: 3000,
    });

    // Wait for turtle-names response so form enables submit
    await page.waitForResponse(
      (resp) => resp.url().includes('turtle-names') && resp.status() === 200,
      { timeout: 10_000 },
    );

    // Now button should be enabled
    const createDataBtn = dialog.getByRole('button', { name: 'Create Turtle Data' });
    await expect(createDataBtn).toBeVisible({ timeout: 3000 });
    await expect(createDataBtn).toBeEnabled();

    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');
    await pickKansasGeneralLocationInCreateTurtleDialog(page, dialog);

    await unlockUntilFieldEditable(page, dialog, 'Name');
    const nameInput = dialog.getByLabel('Name', { exact: true });
    await nameInput.fill('Master Oogway');
    await nameInput.blur();

    await expect(dialog.getByText('This name is already used by another turtle')).toBeVisible({
      timeout: 5000,
    });
    await createDataBtn.click();
    await expect(page.getByText('Please fix the errors in the form')).toBeVisible({
      timeout: 5000,
    });
    await expect(dialog).toBeVisible();
  });

  test('Clicking submit before names load shows validation (no silent bypass)', async ({ page }) => {
    test.setTimeout(90_000);

    // Slow turtle-names: user can try to submit before it finishes
    await page.route('**/api/sheets/turtle-names', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          names: MOCK_EXISTING_NAMES,
        }),
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

    await registerKansasGeneralLocationsCatalogMock(page);

    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'submit-before-load-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });

    // Last chance before the dialog mounts and GET /general-locations runs (Playwright matches last-registered routes first).
    await registerKansasGeneralLocationsCatalogMock(page);
    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Do NOT wait for turtle-names. Select sheet, General Location, fill duplicate name, click submit immediately.
    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');
    await pickKansasGeneralLocationInCreateTurtleDialog(page, dialog);
    await unlockUntilFieldEditable(page, dialog, 'Name');
    const nameInput = dialog.getByLabel('Name', { exact: true });
    await nameInput.fill('Master Oogway');
    await nameInput.blur();

    // Submit button should still be disabled (Loading names...) so we can't click it.
    // If it were enabled and we clicked, we must see validation (loading or duplicate error).
    const submitBtn = dialog.getByRole('button', { name: /Create Turtle Data|Loading names/ });
    await expect(submitBtn).toBeVisible({ timeout: 2000 });
    const isDisabled = await submitBtn.isDisabled();
    if (isDisabled) {
      await expect(submitBtn).toContainText('Loading names');
    } else {
      submitBtn.click();
      await expect(
        page.getByText(/Please fix the errors|Loading existing names/),
      ).toBeVisible({ timeout: 5000 });
      await expect(dialog).toBeVisible();
    }
  });
});
