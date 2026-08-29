import { test, expect, type Page } from '@playwright/test';
import {
  loginAsAdmin,
  loginAsCommunity,
  loginAsStaff,
  grantLocationPermission,
  getTestImageBuffer,
} from './fixtures';

/**
 * Carapace-only quick check (staff + admin, strictly read-only).
 *
 * The quick-check endpoint and image serving are mocked, so these tests need
 * no carapace fixture data on disk — they pin the frontend contract: role
 * gating (staff and admin yes, community no), mode indication, read-only
 * results, click-to-compare, and the full reset on back-out.
 */

const QUICK_CHECK_MATCHES = [
  {
    turtle_id: 'F128',
    location: 'Kansas/North Topeka',
    confidence: 0.87,
    score: 412,
    image_path: '/data/Kansas/North Topeka/F128_T1/carapace/F128.JPG',
  },
  {
    turtle_id: 'M201',
    location: 'Kansas/North Topeka',
    confidence: 0.63,
    score: 198,
    image_path: '/data/Kansas/North Topeka/M201_T2/carapace/M201.JPG',
  },
];

async function mockQuickCheckRoutes(page: Page, captured: { body: string | null }) {
  await page.route('**/api/match/quick-check', async (route) => {
    captured.body = route.request().postData();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        photo_type: 'carapace',
        matches: QUICK_CHECK_MATCHES,
        elapsed: 1.23,
      }),
    });
  });
  await page.route('**/api/images*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: getTestImageBuffer(),
    });
  });
}

async function stagePhoto(page: Page, name: string) {
  const fileInput = page.locator('input[type="file"]:not([capture])').first();
  await fileInput.setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: getTestImageBuffer(),
  });
}

test.describe('Carapace-only quick check', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await grantLocationPermission(page);
  });

  test('toggle is not visible for community users', async ({ page }) => {
    await loginAsCommunity(page);
    await expect(page.getByText('Photo Upload').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Carapace-only quick check')).toHaveCount(0);
  });

  test('staff users can see and enable the toggle (everyone but community)', async ({ page }) => {
    await loginAsStaff(page);
    const toggleLabel = page.getByText('Carapace-only quick check');
    await expect(toggleLabel).toBeVisible({ timeout: 10_000 });
    await toggleLabel.click();
    await expect(page.getByLabel('Carapace-only quick check')).toBeChecked();
    await expect(page.getByText(/Carapace-only mode/)).toBeVisible();
  });

  test('full read-only flow: banner, results, compare, back-out reset', async ({ page }) => {
    test.setTimeout(60_000);
    const captured: { body: string | null } = { body: null };
    await mockQuickCheckRoutes(page, captured);
    await loginAsAdmin(page);

    // Toggle ON → mode is clearly indicated (Mantine hides the native input,
    // so interact via the visible label and assert state on the input)
    const toggleLabel = page.getByText('Carapace-only quick check');
    await expect(toggleLabel).toBeVisible({ timeout: 10_000 });
    await toggleLabel.click();
    await expect(page.getByLabel('Carapace-only quick check')).toBeChecked();
    await expect(page.getByText(/Carapace-only mode/)).toBeVisible();

    // Stage a photo and run the quick check
    await stagePhoto(page, 'carapace-e2e.png');
    const runButton = page.getByRole('button', { name: 'Run quick check' });
    await expect(runButton).toBeVisible({ timeout: 10_000 });
    await runButton.click();

    // Read-only results from the mocked carapace pool
    await expect(page.getByText('Read-only result — nothing was saved.', { exact: false })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Top Carapace Matches')).toBeVisible();
    await expect(page.getByText('F128')).toBeVisible();
    await expect(page.getByText('M201')).toBeVisible();

    // The scope field rode along in the multipart body with the mapped value
    // (default "All locations" = MATCH_ALL sentinel → empty string)
    const scopeField = (captured.body ?? '').match(/name="match_sheet"\r?\n\r?\n([^\r\n]*)/);
    expect(scopeField).not.toBeNull();
    expect(scopeField![1]).toBe('');

    // No write affordance anywhere in this mode
    await expect(
      page.getByRole('button', {
        name: /Create New Turtle|Save to Sheets|Replace|Approve|Upload \d+ photo/i,
      }),
    ).toHaveCount(0);

    // Click a match → enlarged side-by-side comparison
    await page.getByText('F128').first().click();
    await expect(page.getByText('Your photo (not saved)')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Carapace ref: F128')).toBeVisible();
    await expect(page.getByText('Rank 1')).toBeVisible();

    // Back to the ranked list, then all the way out
    await page.getByRole('button', { name: 'Back to matches' }).click();
    await expect(page.getByText('Top Carapace Matches')).toBeVisible();
    await page.getByRole('button', { name: 'Back to upload' }).click();

    // Full reset: toggle OFF, banner gone, results gone, staged photo cleared
    await expect(page.getByLabel('Carapace-only quick check')).not.toBeChecked();
    await expect(page.getByText(/Carapace-only mode/)).toHaveCount(0);
    await expect(page.getByText('Top Carapace Matches')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run quick check' })).toHaveCount(0);
  });

  test('turning the switch off mid-mode restores the normal flow', async ({ page }) => {
    const captured: { body: string | null } = { body: null };
    await mockQuickCheckRoutes(page, captured);
    await loginAsAdmin(page);

    const toggleLabel = page.getByText('Carapace-only quick check');
    await expect(toggleLabel).toBeVisible({ timeout: 10_000 });
    await toggleLabel.click();
    await expect(page.getByLabel('Carapace-only quick check')).toBeChecked();
    await expect(page.getByText(/Carapace-only mode/)).toBeVisible();

    await toggleLabel.click();
    await expect(page.getByText(/Carapace-only mode/)).toHaveCount(0);
    await expect(page.getByLabel('Carapace-only quick check')).not.toBeChecked();
  });
});
