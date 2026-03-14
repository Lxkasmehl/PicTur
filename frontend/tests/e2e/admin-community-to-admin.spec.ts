import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
} from './fixtures';

const MATCH_REQUEST_ID = 'e2e-community-move';
const COMMUNITY_MATCH = {
  turtle_id: 'T1',
  location: 'Community_Uploads/TestSheet',
  distance: 0.45,
  file_path: 'Review_Queue/Req_1/candidate_matches/rank1.jpg',
  filename: 'rank1.jpg',
};

/**
 * E2E: Admin re-finds a community turtle and moves it to the research spreadsheet.
 * Flow: match page with a community candidate → select Sheet + General Location → confirm →
 * backend moves folder and removes from community sheet (mocked here).
 */
test.describe('Admin Community turtle move to admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await grantLocationPermission(page);
  });

  test('Match page: community candidate shows sheet/location form; fill and confirm triggers approve with match_from_community', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // 1) Admin uploads photo so we get a match page with a real request_id
    await page.route('**/api/upload**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = await route.request().postData();
      if (!body) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          request_id: MATCH_REQUEST_ID,
          uploaded_image_path: `Review_Queue/${MATCH_REQUEST_ID}/query.jpg`,
          matches: [COMMUNITY_MATCH],
          message: 'Uploaded',
        }),
      });
    });

    await page.route('**/api/review-queue/' + MATCH_REQUEST_ID, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            item: {
              request_id: MATCH_REQUEST_ID,
              uploaded_image: `Review_Queue/${MATCH_REQUEST_ID}/query.jpg`,
              metadata: {},
              additional_images: [],
              candidates: [
                {
                  rank: 1,
                  turtle_id: COMMUNITY_MATCH.turtle_id,
                  score: 85,
                  image_path: COMMUNITY_MATCH.file_path,
                },
              ],
              status: 'pending',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/sheets/turtle/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/turtle/') && route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            exists: true,
            data: {
              primary_id: 'T1',
              id: 'M1',
              name: 'Community Turtle',
              sex: 'M',
              sheet_name: 'TestSheet',
              general_location: 'TestSheet',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/sheets/sheets**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, sheets: ['Kansas'] }),
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
          body: JSON.stringify({ success: true }),
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

    let approvePayload: unknown = null;
    await page.route('**/api/review/' + MATCH_REQUEST_ID + '/approve', async (route) => {
      if (route.request().method() === 'POST') {
        approvePayload = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'Approved' }),
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
      name: 'e2e-community-move.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);

    await expect(page).toHaveURL(new RegExp(`/admin/turtle-match/${MATCH_REQUEST_ID}`), {
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });

    // Select the community match (T1, Community_Uploads/TestSheet)
    await expect(page.getByText(COMMUNITY_MATCH.location)).toBeVisible({ timeout: 10_000 });
    await page.getByText(COMMUNITY_MATCH.turtle_id).first().click();

    // Form should show; for community match, Sheet / Location and General Location are editable
    // On mobile (≤768px) we use NativeSelect (native <select>); on desktop we use Mantine Select (listbox in portal)
    const sheetLocationInput = page.getByRole('combobox', { name: 'Sheet / Location' });
    await expect(sheetLocationInput).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/General Location/)).toBeVisible({
      timeout: 5000,
    });

    const isNativeSelect = await sheetLocationInput.evaluate((el) => (el as HTMLElement).tagName === 'SELECT');
    if (isNativeSelect) {
      await sheetLocationInput.selectOption({ label: 'Kansas' });
    } else {
      await sheetLocationInput.click();
      await page.getByRole('listbox').getByRole('option', { name: 'Kansas' }).click();
    }
    await page.getByLabel(/General Location/).fill('Wichita');

    await page.getByRole('button', { name: 'Save to Sheets & Confirm Match' }).click();

    await expect(page).toHaveURL('/', { timeout: 15_000 });

    expect(approvePayload).not.toBeNull();
    const payload = approvePayload as { match_from_community?: boolean; community_sheet_name?: string; match_turtle_id?: string; sheets_data?: { sheet_name?: string; general_location?: string } };
    expect(payload.match_from_community).toBe(true);
    expect(payload.community_sheet_name).toBe('TestSheet');
    expect(payload.match_turtle_id).toBe(COMMUNITY_MATCH.turtle_id);
    expect(payload.sheets_data?.sheet_name).toBe('Kansas');
    expect(payload.sheets_data?.general_location).toBe('Wichita');
  });
});
