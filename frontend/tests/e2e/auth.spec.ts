import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsStaff, loginAsCommunity, navClick } from './fixtures';

test.describe('Auth', () => {
  test('Login page shows form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('Admin login leads to home with Admin badge', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('role-badge')).toHaveText(/Admin/);
  });

  test('Staff login leads to home with Staff badge', async ({ page }) => {
    await loginAsStaff(page);
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('role-badge')).toHaveText(/Staff/);
  });

  test('Community login leads to home with Community badge', async ({ page }) => {
    await loginAsCommunity(page);
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('role-badge')).toHaveText(/Community/);
  });

  test('Logout redirects to home page', async ({ page }) => {
    await loginAsAdmin(page);
    await navClick(page, 'Logout');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'Login' }).first()).toBeVisible();
  });

  test('Community is redirected from admin pages to home', async ({ page }) => {
    await loginAsCommunity(page);
    await page.goto('/admin/turtle-records');
    await expect(page).toHaveURL('/');
    await page.goto('/admin/turtle-match/any-id');
    await expect(page).toHaveURL('/');
  });
});
