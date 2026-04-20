import { test, expect } from '@playwright/test';
import { loginAsAdmin, navClick } from './fixtures';

/**
 * Google Sheets Browser — Photo tags mode: label search UI and grouped results (API mocked).
 */

test.describe('Admin Turtle Records — Sheets browser photo tags', () => {
  test('Photo tags search shows matches from search-labels API', async ({ page }) => {
    test.setTimeout(60_000);

    const mockTurtle = {
      id: 'M1',
      primary_id: 'M1',
      sheet_name: 'Kansas',
      name: 'Tag Search Turtle',
      species: 'Painted',
      sex: 'F',
    };

    await page.route('**/api/review-queue', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, items: [] }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/sheets/sheets', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, sheets: ['Kansas'] }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/sheets/turtles**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, turtles: [mockTurtle] }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/turtles/images/primaries', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            images: [
              { turtle_id: 'M1', sheet_name: 'Kansas', primary: null },
            ],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/turtles/images/search-labels**', async (route) => {
      const url = new URL(route.request().url());
      const q = (url.searchParams.get('q') || '').toLowerCase();
      if (q.includes('burn')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            matches: [
              {
                turtle_id: 'M1',
                sheet_name: 'Kansas',
                path: 'Kansas/2024-06-01/e2e_tagged.jpg',
                filename: 'e2e_tagged.jpg',
                type: 'carapace',
                labels: ['burned', 'e2e-smoke'],
              },
            ],
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ matches: [] }),
        });
      }
    });

    await loginAsAdmin(page);
    await navClick(page, 'Turtle Records');
    await expect(page.getByRole('tab', { name: /Google Sheets Browser/ })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('tab', { name: /Google Sheets Browser/ }).click();

    const locationInput = page.getByRole('textbox', { name: /Location \(Spreadsheet\)/i });
    await expect(locationInput).toBeVisible({ timeout: 10_000 });

    // Mantine SegmentedControl keeps native radios visually hidden; click the visible label text.
    await page.getByText('Photo tags', { exact: true }).click();

    await page.getByPlaceholder('e.g. burned, shell crack').fill('burned');
    await page.getByRole('button', { name: 'Search photos' }).click();

    await expect(page.getByText(/1 photo match · 1 turtle/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Tag Search Turtle')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open turtle' })).toBeVisible();
    await expect(page.getByText('burned', { exact: true })).toBeVisible();
    // Type badge: capitalize transform may surface as "carapace" or "Carapace" in a11y tree.
    await expect(page.getByText(/^carapace$/i)).toBeVisible();
  });
});
