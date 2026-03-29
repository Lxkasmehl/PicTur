import { test, expect } from '@playwright/test';
import { loginAsCommunity, loginAsStaff, navClick } from './fixtures';

test.describe('Observer HQ (gamification hub)', () => {
  test('Guest sees sign-in teaser on /observer', async ({ page }) => {
    await page.goto('/observer');
    await expect(
      page.getByRole('heading', { name: 'Sign in to unlock the full program' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  });

  test('Logged-in community user sees Observer HQ dashboard', async ({ page }) => {
    await loginAsCommunity(page);
    await page.goto('/observer');
    await expect(page.getByRole('heading', { name: 'Observer HQ', level: 1 })).toBeVisible();
    await expect(page.getByText(/^Observer level \d+$/)).toBeVisible();
  });

  test('Staff can open Observer HQ from nav', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await loginAsStaff(page);
    await navClick(page, 'Observer HQ');
    await expect(page).toHaveURL('/observer');
    await expect(page.getByRole('heading', { name: 'Observer HQ', level: 1 })).toBeVisible();
  });

  test('Mobile: guest home shows Observer teaser with Learn more', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const blurb = page.getByText(/earn XP, unlock badges/i);
    await blurb.scrollIntoViewIfNeeded();
    await expect(blurb).toBeVisible();
    await page.getByRole('link', { name: 'Learn more' }).click();
    await expect(page).toHaveURL('/observer');
  });
});
