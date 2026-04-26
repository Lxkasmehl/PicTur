import { test, expect } from '@playwright/test';
import { loginAsAdmin, registerKansasGeneralLocationsCatalogMock } from './fixtures';

const REQUEST_ID = 'e2e-us-dates';

/**
 * Ensures ISO / mixed sheet date strings from the API are shown as MM/DD/YYYY in the Turtle Match form
 * (see `normalizeTurtleSheetsDateFieldsToUs` in the app).
 */
test.describe('US date display (MM/DD/YYYY)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((rid: string) => {
      localStorage.setItem(
        `match_${rid}`,
        JSON.stringify({
          request_id: rid,
          uploaded_image_path: `Review_Queue/${rid}/query.jpg`,
          matches: [
            {
              turtle_id: 'T1',
              location: 'Community_Uploads/TestSheet',
              confidence: 0.85,
              file_path: `Review_Queue/${rid}/candidate_matches/rank1.jpg`,
              filename: 'rank1.jpg',
            },
          ],
        }),
      );
    }, REQUEST_ID);
  });

  test('Turtle Match: sheet API ISO dates render as US slash format in form fields', async ({ page }) => {
    test.setTimeout(90_000);

    await page.route(`**/api/review-queue/${REQUEST_ID}`, async (route) => {
      if (route.request().method() === 'GET') {
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
              candidates: [
                {
                  rank: 1,
                  turtle_id: 'T1',
                  confidence: 85,
                  image_path: `Review_Queue/${REQUEST_ID}/candidate_matches/rank1.jpg`,
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
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const url = route.request().url();
      if (!url.includes('/turtle/T1')) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          exists: true,
          data: {
            primary_id: 'T1',
            id: 'M001',
            name: 'E2E Date Turtle',
            sheet_name: 'TestSheet',
            general_location: 'TestSheet',
            date_1st_found: '2024-03-15',
            last_assay_date: '2020-12-25',
            dates_refound: '2021-06-15, 2022-07-04',
            radio_replace_date: '2023-11-30',
          },
        }),
      });
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

    await page.route('**/api/turtles/images**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ primary: null, additional: [], loose: [] }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/locations**', async (route) => {
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
    await page
      .getByText('Successfully logged in!')
      .waitFor({ state: 'hidden', timeout: 8000 })
      .catch(() => {});

    await page.goto(`/admin/turtle-match/${REQUEST_ID}`);
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByText('Community_Uploads/TestSheet').waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText('T1').first().click();

    await expect(page.getByLabel('Date 1st found')).toHaveValue('03/15/2024', { timeout: 20_000 });
    await expect(page.getByLabel('Last Assay Date')).toHaveValue('12/25/2020');
    await expect(page.getByLabel('Dates refound')).toHaveValue('06/15/2021, 07/04/2022');
    await expect(page.getByLabel('Radio Replace Date')).toHaveValue('11/30/2023');
  });
});
