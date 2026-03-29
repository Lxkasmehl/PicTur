import { test, expect } from '@playwright/test';
import {
  loginAsCommunity,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
} from './fixtures';

/**
 * End-to-end Observer HQ behaviour: successful community upload dispatches gamification,
 * shows the rewards modal, persists state to the auth service, and reflects on /observer.
 * Serial: shared seeded community user; parallel workers would fight over the same account state.
 */
test.describe.serial('Observer HQ gamification (community upload)', () => {
  test('Successful upload shows XP modal, syncs to auth, updates Observer HQ', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await page.goto('/');
    await grantLocationPermission(page);
    await loginAsCommunity(page);

    const summaryLine = page.getByText(/Level \d+ · \d+ XP/);
    await expect(summaryLine).toBeVisible({ timeout: 15_000 });
    const beforeText = await summaryLine.textContent();
    const xpMatch = beforeText?.match(/·\s*(\d+)\s*XP/);
    const xpBefore = xpMatch ? parseInt(xpMatch[1], 10) : 0;

    const gamePut = page.waitForResponse(
      (response) => {
        const req = response.request();
        if (!req.url().includes('community-game') || req.method() !== 'PUT') return false;
        if (!response.ok) return false;
        try {
          const body = JSON.parse(req.postData() || '{}');
          return (
            typeof body.totalXp === 'number' &&
            body.totalXp >= xpBefore + 30 &&
            typeof body.lifetimeSightings === 'number' &&
            body.lifetimeSightings >= 1
          );
        } catch {
          return false;
        }
      },
      { timeout: 25_000 },
    );

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'e2e-observer-gamification.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });

    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);

    await expect(page.getByRole('heading', { name: 'Sighting recorded' })).toBeVisible({
      timeout: 35_000,
    });
    // Base sighting XP without GPS / manual hint / extra photos
    await expect(page.getByRole('heading', { name: '+30 XP' })).toBeVisible();

    const firstBadge = page.getByText('First Sighting');
    if (await firstBadge.isVisible().catch(() => false)) {
      await expect(firstBadge).toBeVisible();
    }

    await page.getByRole('button', { name: 'Continue' }).click();

    await gamePut;

    await page.goto('/observer');
    await expect(page.getByRole('heading', { name: 'Observer HQ', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: "This week's quests" })).toBeVisible();
    await expect(page.getByText(/\d+\s*\/\s*\d+/).first()).toBeVisible();
    await expect(page.getByText(/\d+\s*\/\s*\d+\s+unlocked/)).toBeVisible();
  });
});
