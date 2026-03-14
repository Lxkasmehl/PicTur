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
    // Normal click so the drawer actually opens on mobile (force: true can fail to trigger toggle on mobile Chrome/Safari).
    await burger.click();
  }
}

/** Clicks a nav link by button label. On mobile (burger visible) opens the drawer, waits for the target button, then clicks it. */
export async function navClick(page: Page, label: string): Promise<void> {
  const burger = page.getByTestId('mobile-menu-button');
  const navButton = page.getByRole('button', { name: label });
  if (await burger.isVisible()) {
    // Mobile: nav links only exist inside the drawer; if the button isn't visible, open the drawer first.
    const buttonVisible = await navButton.isVisible().catch(() => false);
    if (!buttonVisible) {
      await burger.click();
    }
    // Wait for the nav button (only present in drawer on mobile) – don't rely on nav-drawer visibility; on mobile/portal it can be reported differently.
    await navButton.waitFor({ state: 'visible', timeout: 10000 });
    await navButton.click({ force: true });
  } else {
    await navButton.click();
  }
}

/** Login as admin (email/password, waits for home + role badge). */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('/', { timeout: 10000 });
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
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('/', { timeout: 10000 });
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
  const option = page.getByRole('option', { name: sheetName });
  await option.waitFor({ state: 'visible', timeout: SHEET_DROPDOWN_TIMEOUT });
  await option.click();
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
