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
            success: true,
            options: ['F1', 'M2'],
            count: 2,
          }),
        });
      },
    );

    await page.route('**/api/sheets/turtle/mark-deceased', async (route) => {
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
    });

    await page.goto('/');
    await grantLocationPermission(page);
    await loginAsStaff(page);

    await page.getByRole('button', { name: 'Mortality without plastron ID' }).click();
    await expect(page.getByText('Mortality without plastron match')).toBeVisible();

    const sheetSelect = page.getByRole('textbox', { name: 'Spreadsheet tab (location)' });
    await sheetSelect.click();
    const sheetListbox = page.getByRole('listbox', { name: 'Spreadsheet tab (location)' });
    await sheetListbox.waitFor({ state: 'visible', timeout: 15_000 });
    await sheetListbox.getByRole('option', { name: MOCK_SHEET, exact: true }).click();

    await expect(page.getByText('Loading values from this sheet…')).not.toBeVisible({
      timeout: 15_000,
    });

    const biologyLabel = 'Biology ID';
    const biologySelect = page
      .getByRole('textbox', { name: biologyLabel })
      .or(page.getByRole('combobox', { name: biologyLabel }));
    await biologySelect.click();
    // Portaled Mantine listboxes: scope options to this field; WebKit sometimes omits listbox name (see fixtures.ts).
    const namedBioListbox = page.getByRole('listbox', { name: biologyLabel });
    const useNamedBio = await namedBioListbox
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    const bioListbox = useNamedBio ? namedBioListbox : page.getByRole('listbox').last();
    await bioListbox.waitFor({ state: 'visible', timeout: 15_000 });
    await biologySelect.fill('F1');
    await bioListbox.getByRole('option', { name: 'F1', exact: true }).click();

    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText('Deceased status updated').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
