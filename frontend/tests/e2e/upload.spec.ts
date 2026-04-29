import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
} from './fixtures';

test.describe('Photo Upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await grantLocationPermission(page);
  });

  test('Admin: selecting file and starting upload leads to match page', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'e2e-turtle.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });

    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);

    await expect(page).toHaveURL(/\/admin\/turtle-match\/[^/]+/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /Turtle Match Review/ })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Upload shows progress (uploading or location)', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'e2e-progress.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });

    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await clickUploadPhotoButton(page);

    // Either progress text appears or we navigate quickly to match page (fast CI/webkit)
    const progressOrLocation = page.getByText(/Getting location|Uploading/i);
    const matchUrl = /\/admin\/turtle-match\/[^/]+/;
    await Promise.race([
      progressOrLocation.waitFor({ state: 'visible', timeout: 8000 }),
      page.waitForURL(matchUrl, { timeout: 8000 }),
    ]);

    await expect(page).toHaveURL(matchUrl, { timeout: 30_000 });
  });

  test('Admin: Additional photos (optional) section shows extended category buttons', async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture])').first();
    await fileInput.setInputFiles({
      name: 'e2e-extra.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });

    await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
    await expect(page.getByText('Additional photos (optional)')).toBeVisible();
    await expect(page.getByText('Microhabitat', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Condition', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Right side', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Left side', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Anterior', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Posterior', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('People', { exact: true }).first()).toBeVisible();
  });

  test('Admin: drag-and-drop onto Additional photos category button stages file', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      /Mobile/i.test(testInfo.project.name) || browserName === 'webkit',
      'Drag-and-drop event simulation is unstable on mobile/WebKit projects.',
    );
    test.setTimeout(30_000);
    await loginAsAdmin(page);

    const fileInput = page.locator('input[type="file"]:not([capture]):not([multiple])').first();
    await fileInput.setInputFiles({
      name: 'e2e-dnd-main.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });

    await expect(page.getByRole('button', { name: 'Upload Photo' }).first()).toBeVisible({
      timeout: 5000,
    });
    const additionalSection = page.getByText('Additional photos (optional)').locator('..').locator('..');
    await expect(additionalSection).toBeVisible({ timeout: 5000 });
    const rightSideButton = additionalSection.locator('label:has-text("Right side")').first();
    await expect(rightSideButton).toBeVisible({ timeout: 5000 });

    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([255, 216, 255, 224, 0, 16])], 'dnd-right-side.jpg', {
        type: 'image/jpeg',
      });
      dt.items.add(file);
      return dt;
    });

    await rightSideButton.dispatchEvent('dragenter', { dataTransfer });
    await rightSideButton.dispatchEvent('dragover', { dataTransfer });
    await rightSideButton.dispatchEvent('drop', { dataTransfer });

    await expect(additionalSection.getByText('dnd-right-side.jpg')).toBeVisible({ timeout: 5000 });
  });
});
