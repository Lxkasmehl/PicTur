import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  navClick,
  GENERAL_LOCATION_LABEL,
  expectGeneralLocationIsFreeTextInDialog,
  selectSheetInCreateTurtleDialog,
  selectSexInCreateTurtleDialog,
} from './fixtures';

function mockCommunityQueueItem(requestId: string) {
  return {
    request_id: requestId,
    uploaded_image: `Review_Queue/${requestId}/query.jpg`,
    metadata: { finder: 'E2E GL', state: 'Kansas', location: 'Pond A' },
    additional_images: [],
    candidates: [
      {
        rank: 1,
        turtle_id: 'T1',
        confidence: 85,
        image_path: `Review_Queue/${requestId}/candidate_matches/rank1.jpg`,
      },
    ],
    status: 'pending',
  };
}

/**
 * Review Queue → community upload → Create New Turtle: General Location is free text
 * (not the research catalog dropdown) and survives sheet + sex interaction.
 */
test.describe('Review Queue – community Create New Turtle (general location)', () => {
  test('General Location is free text with optional hint; value kept after sheet + sex', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const requestId = 'Req_e2e_community_gl';

    await page.route('**/api/review-queue**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const pathname = new URL(route.request().url()).pathname.replace(/\/$/, '');
      if (pathname === '/api/review-queue') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            items: [mockCommunityQueueItem(requestId)],
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/sheets/turtle/**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, exists: false, data: {} }),
        });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/sheets/community-sheets**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, sheets: ['E2ECommunityTab'] }),
        });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/general-locations**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            catalog: { states: {}, sheet_defaults: {} },
            states: [],
            sheet_defaults: [],
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/sheets/turtle-names**', async (route) => {
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
          body: JSON.stringify({ success: true, sheets: ['Kansas'] }),
        });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/sheets/generate-id**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, id: 'F1' }),
        });
        return;
      }
      await route.continue();
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');

    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 15_000 });
    await tabPanel.getByText('1 matches').click();
    await expect(page.getByRole('button', { name: /Back to list/ })).toBeVisible({ timeout: 10_000 });

    const communitySheetsLoaded = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        r.url().includes('community-sheets') &&
        r.status() === 200,
      { timeout: 25_000 },
    );
    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    await communitySheetsLoaded;

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Create New Turtle' })).toBeVisible({
      timeout: 15_000,
    });

    await expectGeneralLocationIsFreeTextInDialog(dialog);
    await expect(
      dialog.getByText(/Optional\. Free text; not used for the research spreadsheet folder path\./),
    ).toBeVisible();

    await selectSheetInCreateTurtleDialog(page, dialog, 'E2ECommunityTab');

    const freeTextValue = 'Lake Maple E2E custom area';
    await dialog.getByLabel(GENERAL_LOCATION_LABEL).fill(freeTextValue);

    await selectSexInCreateTurtleDialog(page, dialog, 'F');

    await expect(dialog.getByLabel(GENERAL_LOCATION_LABEL)).toHaveValue(freeTextValue);
  });
});
