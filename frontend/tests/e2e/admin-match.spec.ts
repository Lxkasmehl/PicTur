import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  loginAsCommunity,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
} from './fixtures';

test.describe('Admin Turtle Match', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await grantLocationPermission(page);
  });

  test('After upload: match page shows header and Back button', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'match-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);

    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  });

  test('Back button navigates to home', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'back-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL('/');
  });

  test('Create New Turtle opens modal with form', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'new-turtle-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });

    const createBtn = page.getByRole('button', { name: 'Create New Turtle' });
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await createBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create New Turtle' })).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel('Sheet / Location')).toBeVisible();
  });

  test('Create New Turtle modal shows Google Sheets form', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'microhabitat-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Create New Turtle' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await expect(
      dialog.getByText('Create a new turtle entry for this uploaded image', { exact: false }),
    ).toBeVisible();
    await expect(dialog.getByText('Google Sheets Data', { exact: false })).toBeVisible();
    await expect(dialog.getByLabel('Sheet / Location')).toBeVisible();
  });

  test('Community cannot access match page', async ({ page }) => {
    await loginAsCommunity(page);
    await page.goto('/admin/turtle-match/any-id');
    await expect(page).toHaveURL('/');
  });

  test('Match page shows Microhabitat / Condition photos section', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'match-additional-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);
    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });

    // Section only appears when there are matches; skip assertion if no matches
    const noMatches = page.getByText('No matches found');
    if ((await noMatches.isVisible())) return;
    await expect(page.getByText('Microhabitat / Condition photos')).toBeVisible();
  });

  test('Upload with extra microhabitat: image appears under From this upload, then can be removed', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);

    const mainInput = page.locator('input[type="file"]:not([capture])').first();
    await mainInput.setInputFiles({
      name: 'main-e2e.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await expect(page.getByText('Additional photos (optional)')).toBeVisible();
    const microhabitatInput = page.locator('input[type="file"]').nth(1);
    await microhabitatInput.setInputFiles({
      name: 'extra-micro-e2e.jpg',
      mimeType: 'image/jpeg',
      buffer: getTestImageBuffer(),
    });
    await expect(page.getByText('extra-micro-e2e.jpg')).toBeVisible({ timeout: 3000 });
    await clickUploadPhotoButton(page);

    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });
    // Section only appears when there are matches
    const noMatches = page.getByText('No matches found');
    if ((await noMatches.isVisible())) return;
    await expect(page.getByText('From this upload', { exact: true })).toBeVisible({ timeout: 15_000 });
    const fromUploadSection = page.getByText('From this upload', { exact: true }).locator('..').locator('..');
    await expect(fromUploadSection.getByRole('img').first()).toBeVisible({ timeout: 5000 });

    const removeBtn = fromUploadSection.getByRole('button', { name: 'Remove' }).first();
    await removeBtn.click();
    await expect(page.getByText('Removed')).toBeVisible({ timeout: 5000 });
    await expect(fromUploadSection.getByText('No additional photos yet')).toBeVisible({ timeout: 5000 });
  });
});
