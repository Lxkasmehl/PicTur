import { test, expect, type Page } from '@playwright/test';
import {
  loginAsAdmin,
  navClick,
  getTestImageBuffer,
  clickUploadPhotoButton,
  registerKansasGeneralLocationsCatalogMock,
  pickKansasGeneralLocationInCreateTurtleDialog,
  selectSheetInCreateTurtleDialog,
  selectSexInCreateTurtleDialog,
} from './fixtures';

/**
 * Issue #251: after a new turtle is created, a "Congratulations" pop-up shows the new turtle's
 * ID so the admin does not have to look it up in Turtle Records afterwards. Covers both places
 * a turtle can be created: the Turtle Match page and the Review Queue.
 */

const MOCK_BIOLOGY_ID = 'F900';
const MOCK_PRIMARY_ID = 'P9001';

/** Mocks shared by both create flows: ID generation, names, sheets and the create/approve writes. */
async function mockCreateTurtleBackend(page: Page, requestId: string) {
  await page.route('**/api/sheets/generate-id', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, id: MOCK_BIOLOGY_ID }),
    });
  });

  await page.route('**/api/sheets/generate-primary-id', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, primary_id: MOCK_PRIMARY_ID }),
    });
  });

  await page.route('**/api/sheets/turtle-names**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, names: [] }),
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

  await page.route('**/api/locations', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, locations: ['Kansas', 'Kansas/Wichita'] }),
    });
  });

  await page.route('**/api/sheets/turtle', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route(`**/api/review/${requestId}/approve`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
}

/** GET /api/review-queue/:id for a synthetic request id (not on the real server). */
async function mockReviewQueuePacket(page: Page, item: Record<string, unknown>) {
  const requestId = String(item.request_id);
  await page.route(`**/api/review-queue/${requestId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, item }),
    });
  });
}

async function expectCreatedPopup(page: Page) {
  const popup = page.getByRole('dialog', { name: 'Turtle created' });
  await expect(popup).toBeVisible({ timeout: 20_000 });
  await expect(popup.getByText('Congratulations!')).toBeVisible();
  await expect(popup.getByText(`You created ${MOCK_BIOLOGY_ID}`)).toBeVisible();
  await expect(popup.getByTestId('turtle-created-id')).toHaveText(MOCK_BIOLOGY_ID);
  await expect(popup.getByTestId('turtle-created-primary-id')).toHaveText(MOCK_PRIMARY_ID);
  return popup;
}

test.describe('New turtle created pop-up (#251)', () => {
  test('Turtle Match: pop-up shows the new ID and stays until closed, then returns home', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const requestId = 'admin_e2e-created-popup-match';

    await registerKansasGeneralLocationsCatalogMock(page);
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
    await mockReviewQueuePacket(page, {
      request_id: requestId,
      uploaded_image: `Review_Queue/${requestId}/query.jpg`,
      metadata: {},
      additional_images: [],
      candidates: [],
      status: 'pending',
    });
    await mockCreateTurtleBackend(page, requestId);

    await loginAsAdmin(page);
    await page
      .getByText('Successfully logged in!')
      .waitFor({ state: 'hidden', timeout: 8000 })
      .catch(() => {});

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'created-popup-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(new RegExp(`/admin/turtle-match/${requestId}`), {
      timeout: 30_000,
    });

    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New Turtle' });
    await expect(dialog).toBeVisible();

    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');
    await pickKansasGeneralLocationInCreateTurtleDialog(page, dialog);
    await selectSexInCreateTurtleDialog(page, dialog, 'F');
    await expect(dialog.getByLabel('ID', { exact: true })).toHaveValue(MOCK_BIOLOGY_ID, {
      timeout: 25_000,
    });

    await dialog.getByRole('button', { name: /Create Turtle Data/ }).click();

    const popup = await expectCreatedPopup(page);
    await expect(dialog).toBeHidden();

    // The page must not navigate away on its own while the pop-up is open
    await page.waitForTimeout(1500);
    await expect(popup).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/admin/turtle-match/${requestId}`));

    await popup.getByRole('button', { name: 'Close' }).click();
    await expect(popup).toBeHidden();
    await expect(page).toHaveURL('/', { timeout: 15_000 });
  });

  test('Review Queue: pop-up shows the new ID and closes back to the queue', async ({ page }) => {
    test.setTimeout(90_000);
    const requestId = 'admin_e2e-created-popup-queue';
    const queueItem = {
      request_id: requestId,
      uploaded_image: `Review_Queue/${requestId}/query.jpg`,
      metadata: { finder: 'E2E Popup', state: 'Kansas', location: 'Wichita' },
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

    await registerKansasGeneralLocationsCatalogMock(page);
    await page.route('**/api/review-queue**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const pathname = new URL(route.request().url()).pathname.replace(/\/$/, '');
      if (pathname !== '/api/review-queue') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [queueItem] }),
      });
    });
    await mockReviewQueuePacket(page, queueItem);
    await page.route('**/api/sheets/turtle/**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, exists: false, data: {} }),
      });
    });
    await mockCreateTurtleBackend(page, requestId);

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    await page.getByRole('tab', { name: /Review Queue/ }).click();

    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 15_000 });
    await tabPanel.getByText('1 matches').click();
    await expect(page.getByRole('button', { name: /Back to list/ })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New Turtle' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await selectSheetInCreateTurtleDialog(page, dialog, 'Kansas');
    await pickKansasGeneralLocationInCreateTurtleDialog(page, dialog);
    await selectSexInCreateTurtleDialog(page, dialog, 'F');
    await expect(dialog.getByLabel('ID', { exact: true })).toHaveValue(MOCK_BIOLOGY_ID, {
      timeout: 25_000,
    });

    await dialog.getByRole('button', { name: /Create Turtle Data/ }).click();

    const popup = await expectCreatedPopup(page);
    await popup.getByRole('button', { name: 'Close' }).click();
    await expect(popup).toBeHidden();
    await expect(page).toHaveURL(/\/admin\/turtle-records/);
  });
});
