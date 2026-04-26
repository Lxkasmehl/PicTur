import { test, expect } from '@playwright/test';
import { loginAsStaff, loginAsCommunity, grantLocationPermission } from './fixtures';

const MOCK_SHEET = 'E2E_Mortality_Tab';

test.describe('Home – mortality without plastron (mark deceased)', () => {
  test('Community user does not see mortality entry point', async ({ page }) => {
    await page.goto('/');
    await grantLocationPermission(page);
    await loginAsCommunity(page);
    await expect(
      page.getByRole('button', { name: 'Mortality without plastron ID' }),
    ).not.toBeVisible();
  });

  test('Staff opens modal, loads mocked lookup options, and Apply succeeds', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await page.route('**/api/sheets/sheets', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, sheets: [MOCK_SHEET] }),
      });
    });

    // Match any host (localhost vs 127.0.0.1, CI) — unmocked lookup shows TextInput, not Select (no role=option).
    await page.route(
      (url) => url.pathname.includes('/api/sheets/mark-deceased/lookup-options'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            // Empty list → TextInput (native fill updates React state). Mantine Select + Playwright is flaky on
            // mobile, and DOM-only fill on Select does not set controlled value without picking an option.
            success: true,
            options: [],
            count: 0,
          }),
        });
      },
    );

    await page.route(
      (url) => url.pathname.includes('/api/sheets/turtle/mark-deceased'),
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            primary_id: 'e2e-primary',
            biology_id: 'F1',
            name: 'E2E Turtle',
            deceased: 'Yes',
            message: 'Deceased status updated',
          }),
        });
      },
    );

    await page.goto('/');
    await grantLocationPermission(page);
    await loginAsStaff(page);

    const mortalityBtn = page.getByRole('button', { name: 'Mortality without plastron ID' });
    await mortalityBtn.scrollIntoViewIfNeeded();
    await mortalityBtn.click({ force: true });
    await expect(page.getByText('Mortality without plastron match')).toBeVisible();

    const markModal = page
      .getByRole('dialog')
      .filter({ has: page.getByText(/For mortalities you cannot scan/i) });

    const sheetSelect = markModal.getByRole('textbox', { name: 'Spreadsheet tab (location)' });
    await sheetSelect.scrollIntoViewIfNeeded();
    await sheetSelect.click({ force: true });
    const sheetListbox = page.getByRole('listbox', { name: 'Spreadsheet tab (location)' });
    await sheetListbox.waitFor({ state: 'visible', timeout: 15_000 });
    await sheetListbox.getByRole('option', { name: MOCK_SHEET, exact: true }).click();
    await sheetListbox.waitFor({ state: 'hidden', timeout: 15_000 });

    await expect(markModal.getByText('Loading values from this sheet…')).not.toBeVisible({
      timeout: 15_000,
    });

    // Exclude the "Biology ID …" radio option — it also associates with label text containing "Biology ID".
    const biologyField = markModal.getByRole('textbox', { name: 'Biology ID' });
    await expect(biologyField).toBeVisible({ timeout: 15_000 });
    await biologyField.scrollIntoViewIfNeeded();

    await biologyField.fill('F1');

    const loginToast = page
      .getByRole('alert')
      .filter({ hasText: /Successfully logged in/i })
      .getByRole('button')
      .first();
    if (await loginToast.isVisible().catch(() => false)) {
      await loginToast.click();
    }

    const applyBtn = markModal.getByRole('button', { name: 'Apply' });
    await applyBtn.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).pathname.includes('/api/sheets/turtle/mark-deceased'),
        { timeout: 15_000 },
      ),
      applyBtn.click(),
    ]);

    await expect(page.getByText('Deceased status updated').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
