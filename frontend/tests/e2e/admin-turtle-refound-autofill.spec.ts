import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  getTestImageBuffer,
  clickUploadPhotoButton,
  selectSheetInCreateTurtleDialog,
  todayUsSlash,
} from './fixtures';

/**
 * Regression coverage for the "Dates Refound" auto-fill feature: selecting a match (or confirming
 * a new turtle) should stamp today's date into Dates Refound, without duplicating an already-present
 * entry, and surface a "Date Refound auto-filled" notification explaining why the field changed.
 * See `appendTodayToDatesRefound` in usDateFormat.ts and its call sites in useAdminTurtleMatch.tsx.
 */
test.describe('Dates Refound auto-fill on match confirmation', () => {
  test('Selecting a match with existing refound dates appends today without dropping history, and notifies', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const REQUEST_ID = 'e2e-refound-autofill-existing';

    await page.addInitScript((rid: string) => {
      localStorage.setItem(
        `match_${rid}`,
        JSON.stringify({
          request_id: rid,
          uploaded_image_path: `Review_Queue/${rid}/query.jpg`,
          matches: [
            {
              turtle_id: 'T1',
              location: 'Kansas',
              confidence: 0.85,
              file_path: `Review_Queue/${rid}/candidate_matches/rank1.jpg`,
              filename: 'rank1.jpg',
            },
          ],
        }),
      );
    }, REQUEST_ID);

    await page.route(`**/api/review-queue/${REQUEST_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
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

    await page.route('**/api/sheets/turtle/T1**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          exists: true,
          data: {
            primary_id: 'T1',
            id: 'M001',
            name: 'E2E Refound Turtle',
            sheet_name: 'Kansas',
            general_location: 'Lawrence',
            dates_refound: '2021-06-15',
          },
        }),
      });
    });

    await page.route('**/api/sheets/sheets**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, sheets: ['Kansas'] }),
      });
    });

    await loginAsAdmin(page);
    await page.getByText('Successfully logged in!').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});

    await page.goto(`/admin/turtle-match/${REQUEST_ID}`);
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 20_000,
    });

    const turtleMatch = page.getByText('T1').first();
    await turtleMatch.scrollIntoViewIfNeeded();
    await turtleMatch.click({ force: true });

    await expect(page.getByLabel('Dates refound')).toHaveValue(
      `06/15/2021, ${todayUsSlash()}`,
      { timeout: 20_000 },
    );
    await expect(page.getByText('Date Refound auto-filled')).toBeVisible();
  });

  test('Selecting a match with no prior refound dates fills in only today, and notifies', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const REQUEST_ID = 'e2e-refound-autofill-empty';

    await page.addInitScript((rid: string) => {
      localStorage.setItem(
        `match_${rid}`,
        JSON.stringify({
          request_id: rid,
          uploaded_image_path: `Review_Queue/${rid}/query.jpg`,
          matches: [
            {
              turtle_id: 'T2',
              location: 'Kansas',
              confidence: 0.85,
              file_path: `Review_Queue/${rid}/candidate_matches/rank1.jpg`,
              filename: 'rank1.jpg',
            },
          ],
        }),
      );
    }, REQUEST_ID);

    await page.route(`**/api/review-queue/${REQUEST_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
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

    await page.route('**/api/sheets/turtle/T2**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          exists: true,
          data: {
            primary_id: 'T2',
            id: 'M002',
            name: 'E2E No-Dates Turtle',
            sheet_name: 'Kansas',
            general_location: 'Lawrence',
          },
        }),
      });
    });

    await page.route('**/api/sheets/sheets**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, sheets: ['Kansas'] }),
      });
    });

    await loginAsAdmin(page);
    await page.getByText('Successfully logged in!').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});

    await page.goto(`/admin/turtle-match/${REQUEST_ID}`);
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 20_000,
    });

    const turtleMatch = page.getByText('T2').first();
    await turtleMatch.scrollIntoViewIfNeeded();
    await turtleMatch.click({ force: true });

    await expect(page.getByLabel('Dates refound')).toHaveValue(todayUsSlash(), { timeout: 20_000 });
    await expect(page.getByText('Date Refound auto-filled')).toBeVisible();
  });

  test('Selecting a match whose refound dates already include today does not duplicate it or notify', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const REQUEST_ID = 'e2e-refound-autofill-dedupe';
    const fixedNow = new Date('2024-05-01T12:00:00');

    await page.clock.setFixedTime(fixedNow);

    await page.addInitScript((rid: string) => {
      localStorage.setItem(
        `match_${rid}`,
        JSON.stringify({
          request_id: rid,
          uploaded_image_path: `Review_Queue/${rid}/query.jpg`,
          matches: [
            {
              turtle_id: 'T3',
              location: 'Kansas',
              confidence: 0.85,
              file_path: `Review_Queue/${rid}/candidate_matches/rank1.jpg`,
              filename: 'rank1.jpg',
            },
          ],
        }),
      );
    }, REQUEST_ID);

    await page.route(`**/api/review-queue/${REQUEST_ID}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
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

    await page.route('**/api/sheets/turtle/T3**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          exists: true,
          data: {
            primary_id: 'T3',
            id: 'M003',
            name: 'E2E Already-Today Turtle',
            sheet_name: 'Kansas',
            general_location: 'Lawrence',
            // Already includes "today" under the fixed clock above (05/01/2024).
            dates_refound: '2024-05-01',
          },
        }),
      });
    });

    await page.route('**/api/sheets/sheets**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, sheets: ['Kansas'] }),
      });
    });

    await loginAsAdmin(page);
    await page.getByText('Successfully logged in!').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});

    await page.goto(`/admin/turtle-match/${REQUEST_ID}`);
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 20_000,
    });

    const turtleMatch = page.getByText('T3').first();
    await turtleMatch.scrollIntoViewIfNeeded();
    await turtleMatch.click({ force: true });

    await expect(page.getByLabel('Dates refound')).toHaveValue('05/01/2024', { timeout: 20_000 });
    await expect(page.getByText('Date Refound auto-filled')).toHaveCount(0);
  });

  test('Create New Turtle: confirming a new turtle stamps today into Dates Refound on save', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const requestId = 'admin_e2e-refound-autofill-new-turtle';

    await page.route('**/api/upload**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          request_id: requestId,
          uploaded_image_path: `Review_Queue/${requestId}/query.jpg`,
          matches: [],
          message: 'Uploaded',
        }),
      });
    });

    await page.route('**/api/locations', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations: ['NebraskaCPBS'] }),
      });
    });

    await page.route('**/api/general-locations', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          catalog: {
            states: { Nebraska: ['CPBS', 'Crescent Lake'] },
            sheet_defaults: { NebraskaCPBS: { state: 'Nebraska', general_location: 'CPBS' } },
          },
          states: [{ state: 'Nebraska', locations: ['CPBS', 'Crescent Lake'] }],
          sheet_defaults: [{ sheet_name: 'NebraskaCPBS', state: 'Nebraska', general_location: 'CPBS' }],
        }),
      });
    });

    await page.route('**/api/sheets/turtle-names', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, names: [] }),
      });
    });

    await page.route('**/api/sheets/generate-primary-id', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, primary_id: 'P9001' }),
      });
    });

    const captured: {
      create?: { turtle_data?: { dates_refound?: string } };
      approve?: { sheets_data?: { dates_refound?: string } };
    } = {};
    await page.route('**/api/sheets/turtle', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      captured.create = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route(`**/api/review/${requestId}/approve`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      captured.approve = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await loginAsAdmin(page);
    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'refound-autofill-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(new RegExp(`/admin/turtle-match/${requestId}`), { timeout: 30_000 });

    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await selectSheetInCreateTurtleDialog(page, dialog, 'NebraskaCPBS');

    const generalLocationField = dialog.getByLabel(/General Location/);
    await expect(generalLocationField).toHaveValue('CPBS', { timeout: 10_000 });

    await dialog.getByRole('button', { name: /Create Turtle Data/ }).click();

    await expect(page.getByText('Date Refound auto-filled')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('New turtle created successfully')).toBeVisible({ timeout: 15_000 });

    expect(captured.create?.turtle_data?.dates_refound).toBe(todayUsSlash());
    expect(captured.approve?.sheets_data?.dates_refound).toBe(todayUsSlash());
  });
});
