import { test, expect } from '@playwright/test';
import { loginAsAdmin, navClick } from './fixtures';

/** Minimal queue item shape for mocking GET /api/review-queue */
function mockQueueItem(requestId: string, overrides: Partial<{ uploaded_image: string; metadata: Record<string, unknown>; candidates: unknown[] }> = {}) {
  return {
    request_id: requestId,
    uploaded_image: `Review_Queue/${requestId}/query.jpg`,
    metadata: { finder: 'E2E Test', state: '', location: '' },
    additional_images: [],
    candidates: [{ rank: 1, turtle_id: 'T1', confidence: 85, image_path: `Review_Queue/${requestId}/candidate_matches/rank1.jpg` }],
    status: 'pending',
    ...overrides,
  };
}

test.describe('Admin Review Queue – upload source badges', () => {
  test('Queue list and detail show Admin upload vs Community upload badge', async ({ page }) => {
    test.setTimeout(60_000);

    const adminItem = mockQueueItem('admin_1731234567_e2e.png');
    const communityItem = mockQueueItem('Req_1731234568_e2e.jpg');

    await page.route('**/api/review-queue', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            items: [adminItem, communityItem],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    await expect(page).toHaveURL('/admin/turtle-records');
    await expect(page.getByRole('tab', { name: /Review Queue/ })).toBeVisible();

    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 5000 });

    // List view: two cards; one should show "Admin upload", one "Community upload"
    const adminBadges = tabPanel.getByTestId('review-upload-source-badge').filter({ hasText: 'Admin upload' });
    const communityBadges = tabPanel.getByTestId('review-upload-source-badge').filter({ hasText: 'Community upload' });
    await expect(adminBadges.first()).toBeVisible({ timeout: 10_000 });
    await expect(communityBadges.first()).toBeVisible({ timeout: 5000 });
    await expect(adminBadges).toHaveCount(1);
    await expect(communityBadges).toHaveCount(1);

    // Click the admin item and check detail view badge
    await tabPanel.getByText('1 matches').first().click();
    await expect(page.getByRole('button', { name: /Back to list/ })).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('review-upload-source-badge')).toHaveText('Admin upload');

    // Back and click community item (click the card that shows Community upload badge)
    await page.getByRole('button', { name: /Back to list/ }).click();
    await tabPanel.getByTestId('review-upload-source-badge').filter({ hasText: 'Community upload' }).click();
    await expect(page.getByRole('button', { name: /Back to list/ })).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('review-upload-source-badge')).toHaveText('Community upload');
  });

  test('Single queue item shows correct badge in list and in detail', async ({ page }) => {
    test.setTimeout(45_000);

    await page.route('**/api/review-queue', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            items: [mockQueueItem('admin_1731234599_single.png')],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 5000 });

    await expect(tabPanel.getByTestId('review-upload-source-badge')).toHaveText('Admin upload');
    await tabPanel.getByText('1 matches').click();
    await expect(page.getByTestId('review-upload-source-badge')).toHaveText('Admin upload');
  });
});
