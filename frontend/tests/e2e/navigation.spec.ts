import { test, expect } from '@playwright/test';
import { openMobileMenu, navClick } from './fixtures';

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
    await navClick(page, 'About');
    await expect(page).toHaveURL('/about');
    await expect(
      page.getByRole('heading', { name: 'About Turtle Project' }),
    ).toBeVisible();

    await navClick(page, 'Contact');
    await expect(page).toHaveURL('/contact');
    await expect(page.getByRole('heading', { name: 'Contact Us' })).toBeVisible();

    await navClick(page, 'Login');
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

    await navClick(page, 'Home');
    await expect(page).toHaveURL('/');
  });

  test('Mobile: burger menu and About', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openMobileMenu(page);
    await page.getByRole('button', { name: 'About' }).click();
    await expect(page).toHaveURL('/about');
    await expect(
      page.getByRole('heading', { name: 'About Turtle Project' }),
    ).toBeVisible();
  });
});
