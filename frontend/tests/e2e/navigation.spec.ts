import { test, expect } from '@playwright/test';
import { navClick, clickFooterNav } from './fixtures';

test.describe('Navigation (public)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Home page shows Photo Upload', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Photo Upload' })).toBeVisible();
  });

  test('Navigate across all public pages', async ({ page }) => {
    test.skip(
      ['Mobile Chrome', 'Mobile Safari'].includes(test.info().project.name),
      'Nav/drawer flakiness on mobile',
    );
    await clickFooterNav(page, 'About');
    await expect(page).toHaveURL('/about');
    await expect(
      page.getByRole('heading', { level: 1, name: /PicTur.*Washburn turtle team/i }),
    ).toBeVisible();

    await clickFooterNav(page, 'Contact');
    await expect(page).toHaveURL('/contact');
    await expect(page.getByRole('heading', { level: 1, name: 'Contact' })).toBeVisible();

    await navClick(page, 'Login');
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

    await navClick(page, 'Home');
    await expect(page).toHaveURL('/');
  });

  test('Mobile: footer link to About', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.getByTestId('footer-link-about').scrollIntoViewIfNeeded();
    await page.getByTestId('footer-link-about').click();
    await expect(page).toHaveURL('/about');
    await expect(
      page.getByRole('heading', { level: 1, name: /PicTur.*Washburn turtle team/i }),
    ).toBeVisible();
  });
});
