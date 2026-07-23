import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import {
  loginAsAdmin,
  loginAsScopedStaff,
  loginAsStaff,
  loginAsTeamLead,
  navClick,
} from './fixtures';

/**
 * Scoped offline-backup download (team leads + admins).
 *
 * Read-only tests: they only log in as a seeded persona and inspect the Sheets
 * Browser backup control, so they never mutate shared state and are parallel-safe
 * (no `serial` block — same as scoped-group-matching.spec.ts).
 *
 * The backup button's visibility is driven by the REAL enriched `/auth/me`
 * (role + group_role), so `/auth/me` is NOT mocked. The dropdown-option tests
 * additionally mock `/api/locations` so the derivation is deterministic, and the
 * benign sheets reads keep the tab rendering without a live backend. No ZIP is
 * ever streamed (we never click download).
 */

const BACKUP_BUTTON = 'offline-backup-button';

async function mockLocations(page: Page, locations: string[]): Promise<void> {
  const body = JSON.stringify({ success: true, locations });
  const handler = async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } else {
      await route.continue();
    }
  };
  await page.route('**/api/locations', handler);
  await page.route('**/api/locations**', handler);
}

/** Benign sheets/turtles reads so the Sheets Browser tab renders deterministically. */
async function mockSheetsReads(page: Page): Promise<void> {
  await page.route('**/api/sheets/sheets**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, sheets: ['Kansas', 'NebraskaCPBS'] }),
    });
  });
  await page.route('**/api/sheets/turtles**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, turtles: [] }),
    });
  });
}

async function openSheetsBrowser(page: Page): Promise<void> {
  await navClick(page, 'Turtle Records');
  await expect(page.getByRole('tab', { name: /Review Queue/ })).toBeVisible();
  await page.getByRole('tab', { name: /Google Sheets Browser/ }).click();
  await expect(
    page.getByRole('textbox', { name: /Location \(Spreadsheet\)/i }),
  ).toBeVisible({ timeout: 10_000 });
}

async function readBackupOptions(page: Page): Promise<string[]> {
  await page.getByLabel('What to download').click();
  await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 10_000 });
  return page.getByRole('option').allTextContents();
}

test.describe('Scoped offline backup', () => {
  test('Regular scoped staff (member): no backup button', async ({ page }) => {
    await mockSheetsReads(page);
    await loginAsScopedStaff(page);
    await openSheetsBrowser(page);
    await expect(page.getByTestId(BACKUP_BUTTON)).toHaveCount(0);
  });

  test('Global staff (non-lead): no backup button', async ({ page }) => {
    await mockSheetsReads(page);
    await loginAsStaff(page);
    await openSheetsBrowser(page);
    await expect(page.getByTestId(BACKUP_BUTTON)).toHaveCount(0);
  });

  test('Team lead: backup button + dropdown limited to their areas', async ({
    page,
    isMobile,
  }) => {
    // Reading a portaled Mantine Select's options is unreliable on the mobile
    // projects (portal not surfaced to Playwright — see fixtures.ts). The
    // derivation is browser-agnostic and fully covered on desktop; on mobile we
    // still assert the button is present below.
    await mockSheetsReads(page);
    await mockLocations(page, [
      'Kansas',
      'Kansas/Topeka',
      'Kansas/Lawrence',
      'NebraskaCPBS',
      'Nebraska/Lincoln',
    ]);
    await loginAsTeamLead(page);
    await openSheetsBrowser(page);

    await expect(page.getByTestId(BACKUP_BUTTON)).toBeVisible();
    if (isMobile) return;

    const options = await readBackupOptions(page);
    const joined = options.join('\n');
    // The lead owns Kansas/Topeka only.
    expect(joined).toContain('Everything (my areas)');
    expect(joined).toContain('Kansas/Topeka');
    // Broader / out-of-scope areas never appear (would 403 server-side).
    expect(options.some((o) => /Nebraska/i.test(o))).toBeFalsy();
    expect(options.some((o) => /Lawrence/i.test(o))).toBeFalsy();
  });

  test('Admin: backup button + full dropdown', async ({ page, isMobile }) => {
    await mockSheetsReads(page);
    await mockLocations(page, [
      'Kansas',
      'Kansas/Topeka',
      'NebraskaCPBS',
      'Nebraska/Lincoln',
    ]);
    await loginAsAdmin(page);
    await openSheetsBrowser(page);

    await expect(page.getByTestId(BACKUP_BUTTON)).toBeVisible();
    if (isMobile) return;

    const options = await readBackupOptions(page);
    const joined = options.join('\n');
    expect(joined).toContain('Everything');
    expect(joined).toContain('Kansas');
    // A global admin is unfiltered: out-of-scope states appear too.
    expect(options.some((o) => /Nebraska/i.test(o))).toBeTruthy();
  });
});
