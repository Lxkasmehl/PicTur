import { test, expect } from '@playwright/test';
import { loginAsAdmin, navClick } from './fixtures';

/** Queue item while SuperPoint matching has not finished (no candidate_matches on disk). */
function mockPendingMatchingItem(requestId: string) {
  return {
    request_id: requestId,
    uploaded_image: `Review_Queue/${requestId}/query.jpg`,
    metadata: { finder: 'E2E Pending', state: 'Kansas', location: 'Topeka' },
    additional_images: [],
    candidates: [],
    match_search_pending: true,
    status: 'pending',
  };
}

function mockReadyItem(requestId: string) {
  return {
    request_id: requestId,
    uploaded_image: `Review_Queue/${requestId}/query.jpg`,
    metadata: { finder: 'E2E Ready', state: '', location: '' },
    additional_images: [],
    candidates: [
      {
        rank: 1,
        turtle_id: 'T1',
        confidence: 90,
        image_path: `Review_Queue/${requestId}/candidate_matches/Rank1_IDT1_Conf90.jpg`,
      },
    ],
    match_search_pending: false,
    match_search_failed: false,
    match_search_error: null,
    status: 'pending',
  };
}

function mockFailedMatchingItem(requestId: string) {
  return {
    request_id: requestId,
    uploaded_image: `Review_Queue/${requestId}/query.jpg`,
    metadata: { finder: 'E2E Failed', state: '', location: '' },
    additional_images: [],
    candidates: [],
    match_search_pending: false,
    match_search_failed: true,
    match_search_error: 'SuperPoint unavailable',
    status: 'pending',
  };
}

test.describe('Admin Review Queue – match search pending', () => {
  test('list shows Finding matches when match_search_pending is true', async ({ page }) => {
    const pending = mockPendingMatchingItem('Req_e2e_pending_match');

    await page.route('**/api/review-queue', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, items: [pending] }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 10_000 });

    await expect(tabPanel.getByText(/Finding matches/i)).toBeVisible();
    await expect(tabPanel.getByText('0 matches')).not.toBeVisible();
  });

  test('detail shows background matching message and not match cards', async ({ page }) => {
    const pending = mockPendingMatchingItem('Req_e2e_pending_detail');

    await page.route('**/api/review-queue', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, items: [pending] }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/review-queue/${encodeURIComponent(pending.request_id)}`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, item: pending }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 10_000 });
    await tabPanel.getByText(/Finding matches/i).click();

    await expect(
      page.getByText(/Still running photo matching in the background/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/Match suggestions are not ready yet/i),
    ).toBeVisible();
  });

  test('when pending clears, list shows match count', async ({ page }) => {
    test.setTimeout(120_000);
    const requestId = 'Req_e2e_then_ready';
    const pending = mockPendingMatchingItem(requestId);
    const ready = mockReadyItem(requestId);

    // Time window starts on first queue GET so slow backend/WebServer startup cannot skip "pending".
    let firstQueueGetAt: number | null = null;
    await page.route('**/api/review-queue', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      if (firstQueueGetAt === null) {
        firstQueueGetAt = Date.now();
      }
      const stillPending = Date.now() - firstQueueGetAt < 6500;
      const items = stillPending ? [pending] : [ready];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items }),
      });
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 10_000 });

    await expect(tabPanel.getByText(/Finding matches/i)).toBeVisible();
    await expect(tabPanel.getByText('1 matches')).toBeVisible({ timeout: 60_000 });
    await expect(tabPanel.getByText(/Finding matches/i)).not.toBeVisible();
  });

  test('list shows Match search failed when match_search_failed is true', async ({ page }) => {
    const failed = mockFailedMatchingItem('Req_e2e_failed_match');

    await page.route('**/api/review-queue', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, items: [failed] }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 10_000 });

    await expect(tabPanel.getByText(/Match search failed/i)).toBeVisible();
    await expect(tabPanel.getByText(/Finding matches/i)).not.toBeVisible();
    await expect(tabPanel.getByText('0 matches')).not.toBeVisible();
  });

  test('failed matching detail shows error and Create New Turtle', async ({ page }) => {
    const failed = mockFailedMatchingItem('Req_e2e_failed_detail');

    await page.route('**/api/review-queue', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, items: [failed] }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/review-queue/${encodeURIComponent(failed.request_id)}`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, item: failed }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 10_000 });
    await tabPanel.getByText(/Match search failed/i).click();

    await expect(page.getByText(/Automatic matching failed/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/SuperPoint unavailable/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Create New Turtle/i })).toBeVisible();
  });
});
