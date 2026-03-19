import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  loginAsCommunity,
  navClick,
  openMobileMenu,
  getTestImageBuffer,
} from './fixtures';

test.describe('Admin Turtle Records (Review Queue)', () => {
  test('Admin sees Turtle Records in nav', async ({ page }) => {
    await loginAsAdmin(page);
    await openMobileMenu(page);
    await expect(page.getByRole('button', { name: 'Turtle Records' })).toBeVisible();
  });

  test('Community does not see Turtle Records', async ({ page }) => {
    await loginAsCommunity(page);
    await openMobileMenu(page);
    await expect(page.getByRole('button', { name: 'Turtle Records' })).not.toBeVisible();
  });

  test('Turtle Records opens Review Queue', async ({ page }) => {
    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    await expect(page).toHaveURL('/admin/turtle-records');
    await expect(page.getByRole('tab', { name: /Review Queue/ })).toBeVisible();
  });

  test('Empty queue: "No pending reviews" or Pending badge visible', async ({ page }) => {
    await page.route('**/api/review-queue', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, items: [] }),
      });
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');

    const emptyOrBadge = page
      .getByText('No pending reviews')
      .or(page.locator('text=/\\d+ Pending/i'));
    await expect(emptyOrBadge).toBeVisible({ timeout: 5000 });
  });

  test('Review button opens modal when entries exist', async ({ page }) => {
    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    await expect(page.getByRole('tab', { name: /Review Queue/ })).toBeVisible();

    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    const hasItems = await tabPanel.getByText(/\d+ matches/).count() > 0;
    if (hasItems) {
      await tabPanel.getByText(/\d+ matches/).first().click();
      await expect(page.getByRole('button', { name: /Back to list/ })).toBeVisible();
      await expect(page.getByText('Uploaded Photo')).toBeVisible();
    } else {
      await expect(page.getByText('No pending reviews')).toBeVisible();
    }
  });

  test('When a queue item is selected, Microhabitat / Condition photos section is visible', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    await expect(page.getByRole('tab', { name: /Review Queue/ })).toBeVisible();

    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    await tabPanel.waitFor({ state: 'visible', timeout: 5000 });
    // Wait for queue content to load (either list items or empty state) to avoid flakiness on slow browsers
    await Promise.race([
      tabPanel.getByText('No pending reviews').waitFor({ state: 'visible', timeout: 10_000 }),
      tabPanel.getByText(/\d+ matches/).first().waitFor({ state: 'visible', timeout: 10_000 }),
    ]);
    const matchLink = tabPanel.getByText(/\d+ matches/).first();
    const hasItems = (await matchLink.count()) > 0;
    if (hasItems) {
      await matchLink.click();
      await expect(page.getByText('Microhabitat / Condition photos')).toBeVisible({ timeout: 5000 });
    } else {
      await expect(page.getByText('No pending reviews')).toBeVisible({ timeout: 10_000 });
    }
  });

  test('On selected queue item: add additional image then remove it', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    await expect(page.getByRole('tab', { name: /Review Queue/ })).toBeVisible();

    const tabPanel = page.getByRole('tabpanel', { name: /Review Queue/ });
    // Wait for queue content to settle (either items or empty state) before branching.
    // Use .first() on the matches text so the locator resolves to one element (strict mode).
    await expect(
      tabPanel
        .getByText('No pending reviews')
        .or(tabPanel.getByText(/\d+ matches/).first()),
    ).toBeVisible({ timeout: 15_000 });
    const matchLink = tabPanel.getByText(/\d+ matches/).first();
    const hasItems = (await matchLink.count()) > 0;
    if (!hasItems) {
      await expect(page.getByText('No pending reviews')).toBeVisible();
      return;
    }
    await matchLink.click();
    await expect(page.getByText('From this upload', { exact: true })).toBeVisible({ timeout: 5000 });
    const fromUploadSection = page.getByText('From this upload', { exact: true }).locator('..').locator('..');
    const fileInputs = fromUploadSection.locator('input[type="file"]');
    const microInput = fileInputs.first();
    await microInput.setInputFiles({
      name: 'e2e-review-extra.jpg',
      mimeType: 'image/jpeg',
      buffer: getTestImageBuffer(),
    });
    await expect(page.getByText('Added', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(fromUploadSection.getByRole('img').first()).toBeVisible({ timeout: 5000 });

    const removeBtn = fromUploadSection.getByRole('button', { name: 'Remove' }).first();
    await removeBtn.click();
    await expect(page.getByText('Removed', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Admin Turtle Records (Sheets Browser)', () => {
  test('Sheets tab: select turtle, add then remove additional image', async ({ page }) => {
    test.setTimeout(90_000);
    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    await expect(page.getByRole('tab', { name: /Review Queue/ })).toBeVisible();
    await page.getByRole('tab', { name: /Google Sheets Browser/ }).click();
    // Wait for Sheets tab content (panel may not have a stable index). Use role=textbox so we match only the input, not the listbox.
    const locationInput = page.getByRole('textbox', { name: /Location \(Spreadsheet\)/i });
    await expect(locationInput).toBeVisible({ timeout: 5000 });
    const tabPanel = page.locator('[role="tabpanel"]').filter({ has: locationInput });
    const sheetSelect = tabPanel.getByRole('textbox', { name: /Location \(Spreadsheet\)/i });
    await sheetSelect.click();
    const firstOption = page.getByRole('option').first();
    const hasSheets = (await firstOption.count()) > 0;
    if (hasSheets) {
      await firstOption.click();
    }
    await page.waitForTimeout(500);
    const turtleCards = tabPanel.locator('[style*="cursor: pointer"]');
    const hasTurtles = (await turtleCards.count()) > 0;
    if (!hasTurtles) {
      await expect(tabPanel.getByText('Select a turtle to edit')).toBeVisible();
      return;
    }
    await turtleCards.first().click();
    await expect(tabPanel.getByText('Turtle photos (Microhabitat / Condition)')).toBeVisible({
      timeout: 5000,
    });
    const photosSection = tabPanel.getByText('Turtle photos (Microhabitat / Condition)').locator('..').locator('..');
    const fileInput = photosSection.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'e2e-sheets-extra.jpg',
      mimeType: 'image/jpeg',
      buffer: getTestImageBuffer(),
    });
    await expect(page.getByText('Added', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(photosSection.getByRole('img').first()).toBeVisible({ timeout: 5000 });

    const removeBtn = photosSection.getByRole('button', { name: 'Remove' }).first();
    await removeBtn.click();
    await expect(page.getByText('Removed', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('Edit mode: ID field is read-only and shows read-only description', async ({ page }) => {
    test.setTimeout(60_000);

    const mockTurtle = {
      id: 'M1',
      sheet_name: 'Kansas',
      name: 'Test Turtle',
      sex: 'M',
      species: '',
    };

    await page.route('**/api/sheets/sheets**', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, sheets: ['Kansas'] }),
        });
      }
      return route.continue();
    });

    await page.route('**/api/sheets/turtles**', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, turtles: [mockTurtle] }),
        });
      }
      return route.continue();
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    await expect(page.getByRole('tab', { name: /Review Queue/ })).toBeVisible();
    await page.getByRole('tab', { name: /Google Sheets Browser/ }).click();

    const locationInput = page.getByRole('textbox', { name: /Location \(Spreadsheet\)/i });
    await expect(locationInput).toBeVisible({ timeout: 5000 });
    const tabPanel = page.locator('[role="tabpanel"]').filter({ has: locationInput });

    // Tab load triggers loadAllTurtles(); mock returns one turtle. Click first card to open edit form.
    const turtleCards = tabPanel.locator('[style*="cursor: pointer"]');
    await expect(turtleCards.first()).toBeVisible({ timeout: 10_000 });
    await turtleCards.first().click();

    // Edit form: ID field must be disabled and show read-only description (branch: ID always read-only)
    const idField = tabPanel.getByLabel('ID', { exact: true });
    await expect(idField).toBeVisible({ timeout: 5000 });
    await expect(idField).toHaveValue('M1');
    await expect(idField).toBeDisabled();
    await expect(
      tabPanel.getByText('Original turtle ID (read-only; may not be unique across sheets)'),
    ).toBeVisible();
  });
});
