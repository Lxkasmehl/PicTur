import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  loginAsStaff,
  navClick,
  openMobileMenu,
} from './fixtures';

test.describe('Staff role and User Management', () => {
  test('Staff sees Turtle Records and Release in nav but not User Management', async ({
    page,
  }) => {
    await loginAsStaff(page);
    await openMobileMenu(page);
    await expect(page.getByRole('button', { name: 'Turtle Records' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Release' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'User Management' }),
    ).not.toBeVisible();
  });

  test('Staff can access Turtle Records and Release pages', async ({ page }) => {
    // Use wide viewport so nav is in header (no drawer); avoids flaky drawer/portal visibility in Playwright.
    await page.setViewportSize({ width: 1400, height: 800 });
    await loginAsStaff(page);
    await navClick(page, 'Turtle Records');
    await expect(page).toHaveURL(/\/admin\/turtle-records/);
    await navClick(page, 'Release');
    await expect(page).toHaveURL('/admin/release');
  });

  test('Staff is redirected from User Management to home', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/admin/users');
    await expect(page).toHaveURL('/');
  });

  test('Admin sees User Management in nav and can open it', async ({ page }) => {
    await loginAsAdmin(page);
    await openMobileMenu(page);
    await expect(
      page.getByRole('button', { name: 'User Management' }),
    ).toBeVisible();
    await navClick(page, 'User Management');
    await expect(page).toHaveURL('/admin/users');
    await expect(
      page.getByRole('heading', { name: 'User Management' }),
    ).toBeVisible();
  });

  test('Admin can change a user role via User Management', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/users');
    await expect(page).toHaveURL('/admin/users');
    await expect(
      page.getByRole('heading', { name: /All users by role/i }),
    ).toBeVisible();
    // Use dedicated role-test user so community@test.com is never mutated (other tests expect Community badge)
    const roleTestEmail =
      process.env.E2E_ROLE_TEST_EMAIL ?? 'role-test-community@test.com';
    const row = page.locator('table tbody tr').filter({ hasText: roleTestEmail });
    await expect(row).toBeVisible({ timeout: 10000 });

    // Mantine Select: open dropdown (input or combobox in that row), then pick Staff
    const roleTrigger = row.getByRole('combobox').or(row.locator('input')).first();
    await roleTrigger.click();
    await page.getByRole('option', { name: 'Staff' }).click();

    // Toast may be slow or portaled; accept either "Role updated" or row moving to Staff section
    await expect(
      page
        .getByText('Role updated', { exact: false })
        .or(
          page
            .locator('table tbody tr')
            .filter({ hasText: roleTestEmail })
            .filter({ hasText: 'Staff' }),
        ),
    ).toBeVisible({ timeout: 10000 });
    // User moved to Staff section: row with role-test email still visible (now under Staff)
    await expect(
      page.locator('table tbody tr').filter({ hasText: roleTestEmail }),
    ).toBeVisible();
  });
});
