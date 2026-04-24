import { test, expect, type Page } from '@playwright/test';
import {
  loginAsAdmin,
  loginAsCommunity,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
  selectSheetInCreateTurtleDialog,
  unlockUntilFieldEditable,
  GENERAL_LOCATION_LABEL,
  registerKansasGeneralLocationsCatalogMock,
} from './fixtures';

/**
 * After opening the General Location Mantine dropdown, resolves the portaled listbox.
 * WebKit often omits the accessible name on that listbox; same strategy as `selectGeneralLocationInCreateTurtleDialog` in fixtures.ts.
 */
async function waitForGeneralLocationListbox(page: Page, visibilityTimeoutMs: number) {
  const namedListbox = page.getByRole('listbox', { name: GENERAL_LOCATION_LABEL });
  const useNamed = await namedListbox
    .waitFor({ state: 'visible', timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  const listbox = useNamed ? namedListbox : page.getByRole('listbox').last();
  await listbox.waitFor({ state: 'visible', timeout: visibilityTimeoutMs });
  return listbox;
}

test.describe('Admin Turtle Match', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await grantLocationPermission(page);
  });

  test('HomePage: match scope section shows new options and helper text mentions Incidental Finds', async ({
    page,
  }) => {
    // Mock locations so admin home renders the scope section (not "No locations yet")
    await page.route('**/api/locations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, locations: ['Kansas'] }),
        });
      } else {
        await route.continue();
      }
    });
    await loginAsAdmin(page);
    await page.getByText('Loading locations…').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    await expect(page.getByText('Which location to test against?')).toBeVisible({ timeout: 5000 });
    const helperText = page.getByText(/Incidental Finds/, { exact: false });
    await expect(helperText).toBeVisible();
    await expect(helperText).toContainText('Community Turtles only');
    await expect(helperText).toContainText('All locations');
  });

  test('After upload: match page shows header and Back button', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'match-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);

    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  });

  test('Back button navigates to home', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'back-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL('/');
  });

  test('Create New Turtle opens modal with form', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'new-turtle-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    const createBtn = page.getByRole('button', { name: 'Create New Turtle' });
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await createBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create New Turtle' })).toBeVisible();
    // Create New Turtle modal uses backend locations, so the field is "Sheet (State / Region)" not "Sheet / Location"
    await expect(
      page.getByRole('dialog').getByLabel(/Sheet.*(State \/ Region|Location)/),
    ).toBeVisible();
  });

  test('Create New Turtle modal shows Google Sheets form', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'microhabitat-e2e.png',
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

    await expect(
      dialog.getByText('Create a new turtle entry for this uploaded image', { exact: false }),
    ).toBeVisible();
    await expect(dialog.getByText('Google Sheets Data', { exact: false })).toBeVisible();
    await expect(dialog.getByLabel('Sheet / Location')).toBeVisible();
  });

  test('Create New Turtle shows state-specific General Location dropdown', async ({ page }) => {
    test.setTimeout(60_000);
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
    await page.route('**/api/general-locations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            catalog: {
              states: {
                Kansas: ['Lawrence', 'North Topeka'],
              },
              sheet_defaults: {},
            },
            states: [{ state: 'Kansas', locations: ['Lawrence', 'North Topeka'] }],
            sheet_defaults: [],
          }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/sheets/turtle-names', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, names: [] }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'general-location-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await unlockUntilFieldEditable(page, dialog, GENERAL_LOCATION_LABEL);

    const generalLocationField = dialog.getByLabel(/General Location/);
    await expect(generalLocationField).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole('button', { name: /\+ Add new General Location/ })).toBeVisible();

    const isNativeSelect = await generalLocationField.evaluate((el) => el.tagName === 'SELECT');
    if (isNativeSelect) {
      const options = await generalLocationField.locator('option').allTextContents();
      expect(options).toContain('North Topeka');
    } else {
      await generalLocationField.click();
      const listbox = await waitForGeneralLocationListbox(page, 5000);
      const optionTexts = await listbox.getByRole('option').allTextContents();
      expect(optionTexts).toContain('North Topeka');
      await page.keyboard.press('Escape');
    }
  });

  test('Edit matched research turtle: General Location requires unlock, then catalog dropdown (e.g. West Topeka)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const REQUEST_ID = 'e2e-match-edit-gl-research';

    await page.route('**/api/upload**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          request_id: REQUEST_ID,
          uploaded_image_path: `Review_Queue/${REQUEST_ID}/query.jpg`,
          matches: [
            {
              turtle_id: 'F501',
              location: 'Kansas',
              distance: 0.12,
              file_path: 'Review_Queue/Req_1/candidate_matches/rank1.jpg',
              filename: 'rank1.jpg',
            },
          ],
          message: 'Uploaded',
        }),
      });
    });

    const reviewSuffix = `/api/review-queue/${encodeURIComponent(REQUEST_ID)}`;
    await page.route('**/api/review-queue/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path !== reviewSuffix || route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          item: {
            request_id: REQUEST_ID,
            uploaded_image: `Review_Queue/${REQUEST_ID}/query.jpg`,
            metadata: {},
            additional_images: [],
            candidates: [],
            status: 'pending',
          },
        }),
      });
    });

    await page.route('**/api/sheets/sheets**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, sheets: ['Kansas', 'NebraskaCPBS'] }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/sheets/turtle/F501**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            exists: true,
            data: {
              primary_id: '10042',
              id: 'F501',
              name: 'E2E Match Turtle',
              sheet_name: 'Kansas',
              general_location: 'North Topeka',
              sex: 'M',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await registerKansasGeneralLocationsCatalogMock(page);

    await loginAsAdmin(page);
    await page.getByText('Successfully logged in!').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'match-edit-gl-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);

    await expect(page).toHaveURL(new RegExp(`/admin/turtle-match/${REQUEST_ID}`), { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });

    await page.locator('.mantine-Card-root').filter({ hasText: 'F501' }).first().click();

    // Closest Paper only: nested Mantine Papers both match filter({ has: heading }), which breaks strict mode.
    const sheetsFormCard = page
      .getByRole('heading', { name: /Turtle Data - Google Sheets/ })
      .locator('xpath=ancestor::div[contains(@class,"mantine-Paper-root")][1]');
    await expect(sheetsFormCard).toBeVisible({ timeout: 15_000 });

    await registerKansasGeneralLocationsCatalogMock(page);

    const glField = sheetsFormCard.getByLabel(GENERAL_LOCATION_LABEL);
    await expect(glField).toBeVisible({ timeout: 15_000 });
    await expect(glField).toBeDisabled();
    const glCell = glField.locator('xpath=ancestor::div[contains(@class,"Grid-col")][1]');
    await expect(glCell.getByRole('button', { name: 'Unlock editing' })).toBeVisible();

    await unlockUntilFieldEditable(page, sheetsFormCard, GENERAL_LOCATION_LABEL);

    const isNativeSelect = await glField.evaluate((el) => el.tagName === 'SELECT');
    if (isNativeSelect) {
      const options = await glField.locator('option').allTextContents();
      expect(options).toContain('West Topeka');
    } else {
      await glField.click();
      const listbox = await waitForGeneralLocationListbox(page, 5000);
      const optionTexts = await listbox.getByRole('option').allTextContents();
      expect(optionTexts).toContain('West Topeka');
      await page.keyboard.press('Escape');
    }
  });

  test('Create New Turtle: fixed sheet rule locks General Location to default', async ({ page }) => {
    test.setTimeout(60_000);
    const e2eRequestId = 'admin_e2e-fixed-sheet-gl';
    await page.route('**/upload', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            request_id: e2eRequestId,
            uploaded_image_path: '/e2e/fixed-sheet-gl.png',
            matches: [],
            message: 'Uploaded',
          }),
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
            locations: ['NebraskaCPBS', 'Kansas', 'Kansas/Wichita'],
          }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/general-locations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            catalog: {
              states: {
                Nebraska: ['CPBS', 'Crescent Lake'],
              },
              sheet_defaults: {
                NebraskaCPBS: { state: 'Nebraska', general_location: 'CPBS' },
              },
            },
            states: [{ state: 'Nebraska', locations: ['CPBS', 'Crescent Lake'] }],
            sheet_defaults: [
              { sheet_name: 'NebraskaCPBS', state: 'Nebraska', general_location: 'CPBS' },
            ],
          }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/sheets/turtle-names', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, names: [] }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'fixed-sheet-gl-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await selectSheetInCreateTurtleDialog(page, dialog, 'NebraskaCPBS');

    const generalLocationField = dialog.getByLabel(/General Location/);
    await expect(generalLocationField).toBeVisible({ timeout: 10_000 });
    await expect(generalLocationField).toBeDisabled();
    await expect(generalLocationField).toHaveValue('CPBS');
    await expect(dialog.getByRole('button', { name: /\+ Add new General Location/ })).toHaveCount(0);
    await expect(
      dialog.getByText(/Auto-filled from the sheet rule for Nebraska/i),
    ).toBeVisible();
  });

  test('Create New Turtle: Sheet/Location dropdown shows only top-level states (no sublocations or system folders)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // Backend returns state, sublocation, and system folders; UI must show only selectable states (Kansas), not Kansas/Wichita, Community_Uploads, Incidental_Finds
    await page.route('**/api/locations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            locations: ['Kansas', 'Kansas/Wichita', 'Community_Uploads', 'Incidental_Finds'],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'scope-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });

    const locationsResponse = page.waitForResponse(
      (r) => r.url().includes('/api/locations') && r.status() === 200,
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Create New Turtle' })).toBeVisible();
    await locationsResponse;

    const sheetSelect = dialog.getByLabel('Sheet / Location');
    await expect(sheetSelect).toBeVisible({ timeout: 10_000 });
    const isNativeSelect = await sheetSelect.evaluate((el) => (el as HTMLElement).tagName === 'SELECT');
    if (isNativeSelect) {
      const options = await sheetSelect.locator('option').allTextContents();
      expect(options).toContain('Kansas');
      expect(options).not.toContain('Kansas/Wichita');
      expect(options).not.toContain('Community_Uploads');
      expect(options).not.toContain('Incidental_Finds');
    } else {
      await sheetSelect.click();
      const listbox = page.getByRole('listbox', { name: 'Sheet / Location' });
      await expect(listbox).toBeVisible({ timeout: 5000 });
      const optionTexts = await listbox.getByRole('option').allTextContents();
      expect(optionTexts).toContain('Kansas');
      expect(optionTexts).not.toContain('Kansas/Wichita');
      expect(optionTexts).not.toContain('Community_Uploads');
      expect(optionTexts).not.toContain('Incidental_Finds');
      await page.keyboard.press('Escape');
    }
  });

  test('Community cannot access match page', async ({ page }) => {
    await loginAsCommunity(page);
    await page.goto('/admin/turtle-match/any-id');
    await expect(page).toHaveURL('/');
  });

  test('Match page shows Microhabitat / Condition photos section', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'match-additional-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });

    // Wait for either outcome — avoids racing upload/match load on slow mobile WebKit.
    const noMatches = page.getByText('No matches found');
    const microSection = page.getByText('Microhabitat / Condition photos');
    await expect(noMatches.or(microSection)).toBeVisible({ timeout: 25_000 });
    if (await noMatches.isVisible()) return;
    await expect(microSection).toBeVisible({ timeout: 10_000 });
  });

  test('Upload with extra microhabitat: image appears under From this upload, then can be removed', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);

    const mainInput = page.locator('input[type="file"]:not([capture])').first();
    await mainInput.setInputFiles({
      name: 'main-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await expect(page.getByText('Additional photos (optional)')).toBeVisible();
    const microhabitatInput = page.locator('input[type="file"]').nth(1);
    await microhabitatInput.setInputFiles({
      name: 'extra-micro-e2e.jpg',
      mimeType: 'image/jpeg',
      buffer: getTestImageBuffer(),
    });
    await expect(page.getByText('extra-micro-e2e.jpg')).toBeVisible({ timeout: 3000 });
    await clickUploadPhotoButton(page);

    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });
    // Wait for match results to load before branching
    const noMatches = page.getByText('No matches found');
    const fromUpload = page.getByText('From this upload', { exact: true });
    await expect(noMatches.or(fromUpload)).toBeVisible({ timeout: 10_000 });
    if (await noMatches.isVisible()) return;
    await expect(fromUpload).toBeVisible();
    const fromUploadSection = page.getByText('From this upload', { exact: true }).locator('..').locator('..');
    await expect(fromUploadSection.getByRole('img').first()).toBeVisible({ timeout: 5000 });

    const removeBtn = fromUploadSection.getByRole('button', { name: 'Remove' }).first();
    await removeBtn.click();
    await expect(page.getByText('Removed')).toBeVisible({ timeout: 5000 });
    await expect(fromUploadSection.getByText('No additional photos yet')).toBeVisible({ timeout: 5000 });
  });
});
