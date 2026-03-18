import { Buffer } from 'buffer';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@test.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'testpassword123';
const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL ?? 'staff@test.com';
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'testpassword123';
const COMMUNITY_EMAIL = process.env.E2E_COMMUNITY_EMAIL ?? 'community@test.com';
const COMMUNITY_PASSWORD = process.env.E2E_COMMUNITY_PASSWORD ?? 'testpassword123';

/** Opens the mobile menu (burger), if visible. */
export async function openMobileMenu(page: Page): Promise<void> {
  const burger = page.getByTestId('mobile-menu-button');
  if (await burger.isVisible()) {
    // Force click so overlays (e.g. drawer, portal) do not intercept on mobile
    await burger.click({ force: true });
  }
}

/** Clicks a nav link by button label. When the mobile menu is opened, waits for the nav drawer and the button (by visible text) to be visible, then clicks to avoid flakiness from accessible-name or timing. */
export async function navClick(page: Page, label: string): Promise<void> {
  const burger = page.getByTestId('mobile-menu-button');
  const drawer = page.getByTestId('nav-drawer');
  if (await burger.isVisible()) {
    // Only open the drawer if it's not already open (burger toggles; clicking again would close it and detach the button).
    if (!(await drawer.isVisible())) {
      await burger.click({ force: true });
    }
    await drawer.waitFor({ state: 'visible' });
    // Single locator chain + getByRole: re-query on each retry to avoid "element was detached" when the drawer re-renders (e.g. Mantine open animation).
    await drawer.getByRole('button', { name: label }).click();
  } else {
    await page.getByRole('button', { name: label }).click();
  }
}

/** Login as admin (email/password, waits for home + role badge). */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click({ noWaitAfter: true });

  const loginError = page.getByRole('main').getByRole('alert').filter({ hasText: /invalid|error|password|failed|unauthorized/i });
  const navigated = page.waitForURL('/', { timeout: 15000 }).then(() => true).catch(() => false);
  const errorShown = loginError.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);

  const [didNavigate, didShowError] = await Promise.all([navigated, errorShown]);

  if (didShowError && !didNavigate) {
    const msg = (await loginError.textContent().catch(() => null)) ?? 'Unknown error';
    throw new Error(
      `Login failed: ${msg.trim()}. Run \`npm run test:setup\` in auth-backend to seed test users.`,
    );
  }
  if (!didNavigate) {
    throw new Error('Login timed out. Run `npm run test:setup` in auth-backend and ensure the server is running.');
  }
  await expect(page.getByTestId('role-badge')).toHaveText(/Admin/);
}

/** Login as staff user (admin-like, no user management). */
export async function loginAsStaff(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(STAFF_EMAIL);
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('/', { timeout: 10000 });
  await expect(page.getByTestId('role-badge')).toHaveText(/Staff/);
}

/** Login as community user. */
export async function loginAsCommunity(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(COMMUNITY_EMAIL);
  await page.getByLabel('Password').fill(COMMUNITY_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click({ noWaitAfter: true });

  const loginError = page.getByRole('main').getByRole('alert').filter({ hasText: /invalid|error|password|failed|unauthorized/i });
  const navigated = page.waitForURL('/', { timeout: 15000 }).then(() => true).catch(() => false);
  const errorShown = loginError.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);

  const [didNavigate, didShowError] = await Promise.all([navigated, errorShown]);

  if (didShowError && !didNavigate) {
    const msg = (await loginError.textContent().catch(() => null)) ?? 'Unknown error';
    throw new Error(
      `Login failed: ${msg.trim()}. Run \`npm run test:setup\` in auth-backend to seed test users.`,
    );
  }
  if (!didNavigate) {
    throw new Error('Login timed out. Run `npm run test:setup` in auth-backend and ensure the server is running.');
  }
  await expect(page.getByTestId('role-badge')).toHaveText(/Community/);
}

/** Grants geo permission and mocks getCurrentPosition so no browser dialogs appear. */
export async function grantLocationPermission(page: Page): Promise<void> {
  const url = page.url();
  const origin =
    url && url !== 'about:blank' && url.startsWith('http')
      ? new URL(url).origin
      : undefined;
  if (origin) {
    await page.context().grantPermissions(['geolocation'], { origin });
  } else {
    await page.context().grantPermissions(['geolocation']);
  }
  await page.evaluate(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = function (
        success: PositionCallback,
        _error?: PositionErrorCallback,
      ) {
        const pos = {
          coords: {
            latitude: 0,
            longitude: 0,
            accuracy: 0,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        } as GeolocationPosition;
        setTimeout(() => success(pos), 0);
      };
    }
  });
}

/** Creates a small PNG as Base64 (for setInputFiles with Buffer). */
export function createTestImageBase64(): string {
  return (
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  );
}

/** Buffer of a minimal PNG for setInputFiles. */
export function getTestImageBuffer(): Buffer {
  return Buffer.from(createTestImageBase64().split(',')[1], 'base64');
}

/** Clicks the Upload button on the preview card (not the file button). */
export async function clickUploadPhotoButton(page: Page): Promise<void> {
  await page.locator('button[data-size="md"]:has-text("Upload Photo")').click();
}

/**
 * Selects an option from an open Mantine Select/Combobox by keyboard.
 * Call after clicking the select input. Index 0 = first option.
 * Works when the dropdown is portaled or not visible to Playwright (e.g. mobile).
 * First ArrowDown moves focus from input into the list (onto first option); then we need
 * optionIndex more steps to reach the desired option. So total = optionIndex + 1 for all browsers.
 */
export async function selectComboboxOptionByIndex(
  page: Page,
  optionIndex: number,
): Promise<void> {
  await page.waitForTimeout(150);
  // One ArrowDown to move focus from input into list (onto first option), then optionIndex more.
  const steps = optionIndex + 1;
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
}

const SHEET_SELECT_LABEL = 'Sheet / Location';
const SHEET_DROPDOWN_TIMEOUT = 20_000;

/**
 * In the Create New Turtle dialog, select a sheet (e.g. "Kansas").
 * On mobile we use NativeSelect (native <select>); on desktop, Mantine Select (textbox + listbox).
 * Uses getByLabel so the same helper works for both.
 */
export async function selectSheetInCreateTurtleDialog(
  page: Page,
  dialog: ReturnType<Page['getByRole']>,
  sheetName: string,
): Promise<void> {
  const sheetSelect = dialog.getByLabel(SHEET_SELECT_LABEL);
  await sheetSelect.waitFor({ state: 'visible', timeout: SHEET_DROPDOWN_TIMEOUT });

  const isNativeSelect = await sheetSelect.evaluate((el) => el.tagName === 'SELECT');
  if (isNativeSelect) {
    await sheetSelect.selectOption(sheetName);
    return;
  }

  await sheetSelect.click();
  await page
    .getByRole('listbox', { name: SHEET_SELECT_LABEL })
    .waitFor({ state: 'visible', timeout: SHEET_DROPDOWN_TIMEOUT });
  // exact: true so "Kansas" does not match "Kansas/Wichita" (strict mode)
  const option = page.getByRole('listbox', { name: SHEET_SELECT_LABEL }).getByRole('option', { name: sheetName, exact: true });
  await option.waitFor({ state: 'visible', timeout: SHEET_DROPDOWN_TIMEOUT });
  await option.click();
}

/**
 * Fills the General Location field in Create New Turtle dialog (required for admin backend path).
 */
export async function fillGeneralLocationInCreateTurtleDialog(
  dialog: ReturnType<Page['getByRole']>,
  value: string,
): Promise<void> {
  // Required fields get " *" appended by Mantine, so avoid exact match on the label.
  const field = dialog.getByLabel(/General Location/);
  await field.waitFor({ state: 'visible', timeout: 5000 });
  await field.fill(value);
}

const SEX_SELECT_LABEL = 'Sex';
const SEX_DROPDOWN_TIMEOUT = 10_000;
/** Option order in UI (turtleSheetsDataFormFieldsConfig: F, M, J, U). */
const SEX_OPTION_INDEX: Record<string, number> = { F: 0, M: 1, J: 2, U: 3 };

/**
 * In the Create New Turtle dialog, select Sex (e.g. "F", "M").
 * On mobile we use NativeSelect (native <select>); on desktop, Mantine Select (listbox).
 * Uses keyboard selection for Mantine so options that render outside the viewport (portaled dropdown) still work.
 */
export async function selectSexInCreateTurtleDialog(
  page: Page,
  dialog: ReturnType<Page['getByRole']>,
  value: string,
): Promise<void> {
  const sexSelect = dialog.getByLabel(SEX_SELECT_LABEL);
  await sexSelect.waitFor({ state: 'visible', timeout: SEX_DROPDOWN_TIMEOUT });

  const isNativeSelect = await sexSelect.evaluate((el) => el.tagName === 'SELECT');
  if (isNativeSelect) {
    await sexSelect.selectOption(value);
    return;
  }

  await sexSelect.click();
  const listbox = page.getByRole('listbox', { name: SEX_SELECT_LABEL });
  await listbox.waitFor({ state: 'visible', timeout: SEX_DROPDOWN_TIMEOUT });
  // Keyboard selection avoids portaled options being outside viewport (no option.click).
  const optionIndex = SEX_OPTION_INDEX[value];
  if (optionIndex === undefined) {
    throw new Error(`Unknown sex value: ${value}`);
  }
  await selectComboboxOptionByIndex(page, optionIndex);
  // Wait for listbox to close so the value is committed and generate-id can run.
  await listbox.waitFor({ state: 'hidden', timeout: SEX_DROPDOWN_TIMEOUT });
}
