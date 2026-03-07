import { test, expect } from '@playwright/test';

/**
 * E2E tests: Auth improvements – password policy and email verification.
 * - Registration rejects weak/common passwords at API (server) level.
 * - Verify-email page handles invalid/expired tokens and shows resend/continue.
 */

test.describe('Auth – password policy and email verification', () => {
  test('Registration with common password (server rejection) shows error', async ({ page }) => {
    await page.goto('/register');

    await expect(page.getByRole('heading', { name: /Create|Sign|account/i })).toBeVisible({
      timeout: 5000,
    });

    // Use a password that passes client checks (10+ chars, upper, lower, digit, special)
    // but is rejected by server as too common
    const email = `e2e-common-pw-${Date.now()}@example.com`;
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // Server returns 400 with "too common" or "stronger" message; shown in Alert or notification
    await expect(
      page.getByText(/too common|stronger password|choose a stronger/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Verify-email page with invalid token shows error and options', async ({ page }) => {
    await page.goto('/verify-email?token=invalid-token-12345');

    // Page shows verifying then error (or timeout)
    await expect(page.getByRole('heading', { name: /Verify your email/i })).toBeVisible({
      timeout: 5000,
    });

    // After verification attempt: error or timeout message
    await expect(
      page.getByText(/invalid|expired|failed|timed out|longer than expected/i),
    ).toBeVisible({ timeout: 20_000 });

    // User can continue to start page
    await expect(page.getByRole('button', { name: /Continue to start page/i })).toBeVisible({
      timeout: 2000,
    });
  });

  test('Verify-email page without token shows check your email', async ({ page }) => {
    await page.goto('/verify-email');

    await expect(page.getByRole('heading', { name: /Check your email/i })).toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByText("We've sent a verification link to", { exact: false }),
    ).toBeVisible();
  });
});
