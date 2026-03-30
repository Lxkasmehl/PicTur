import { Buffer } from 'buffer';
import { expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

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
  await option.scrollIntoViewIfNeeded();
  await option.click();
  await page
    .getByRole('listbox', { name: SHEET_SELECT_LABEL })
    .waitFor({ state: 'hidden', timeout: SHEET_DROPDOWN_TIMEOUT });
}

const GENERAL_LOCATION_LABEL = /General Location/;
const GENERAL_LOCATION_DROPDOWN_TIMEOUT = 15_000;

/**
 * Selects a General Location in Create New Turtle dialog (Mantine Select or native select element).
 */
export async function selectGeneralLocationInCreateTurtleDialog(
  page: Page,
  dialog: ReturnType<Page['getByRole']>,
  locationName: string,
): Promise<void> {
  // Portaled Mantine listboxes are outside `dialog`, so dialog-scoped getByLabel hits only the control
  // (avoids strict mode). NativeSelect <select> is not always exposed as textbox; combobox + label cover mobile/WebKit.
  const field = dialog
    .getByRole('textbox', { name: GENERAL_LOCATION_LABEL })
    .or(dialog.getByRole('combobox', { name: GENERAL_LOCATION_LABEL }))
    .or(dialog.getByLabel(GENERAL_LOCATION_LABEL));
  await field.waitFor({ state: 'visible', timeout: GENERAL_LOCATION_DROPDOWN_TIMEOUT });

  const isNativeSelect = await field.evaluate((el) => el.tagName === 'SELECT');
  if (isNativeSelect) {
    const optionByRole = field.getByRole('option', { name: locationName, exact: true });
    await optionByRole.waitFor({ state: 'attached', timeout: GENERAL_LOCATION_DROPDOWN_TIMEOUT });
    await field.selectOption({ label: locationName });
    return;
  }

  await field.click();
  // WebKit often omits the accessible name on the portaled listbox; fall back to the topmost open listbox.
  const namedListbox = page.getByRole('listbox', { name: GENERAL_LOCATION_LABEL });
  const useNamed = await namedListbox
    .waitFor({ state: 'visible', timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  const listbox = useNamed ? namedListbox : page.getByRole('listbox').last();
  await listbox.waitFor({ state: 'visible', timeout: GENERAL_LOCATION_DROPDOWN_TIMEOUT });
  const option = listbox
    .getByRole('option', { name: locationName, exact: true })
    .or(listbox.getByText(locationName, { exact: true }));
  await option.first().waitFor({ state: 'visible', timeout: GENERAL_LOCATION_DROPDOWN_TIMEOUT });
  await option.first().scrollIntoViewIfNeeded();
  await option.first().click();
  await listbox.waitFor({ state: 'hidden', timeout: GENERAL_LOCATION_DROPDOWN_TIMEOUT }).catch(() => {});
}

/** General Location is a dropdown; delegates to selectGeneralLocationInCreateTurtleDialog. */
export async function fillGeneralLocationInCreateTurtleDialog(
  dialog: ReturnType<Page['getByRole']>,
  value: string,
): Promise<void> {
  await selectGeneralLocationInCreateTurtleDialog(dialog.page(), dialog, value);
}

/**
 * Kansas option for Create New Turtle E2E — must exist in {@link registerKansasGeneralLocationsCatalogMock}.
 * Prefer this over "Wichita": CI/minimal catalogs often omit Wichita (options come from GET /api/general-locations).
 */
export const E2E_KANSAS_GENERAL_LOCATION = 'Lawrence';

const E2E_MOCK_KANSAS_GENERAL_LOCATIONS = [
  'Karlyle Woods',
  'Lawrence',
  'North Topeka',
  'Valencia',
  'Wichita',
] as const;

/**
 * Stub GET /api/general-locations for Kansas tests. Uses glob plus pathname match so Docker/nginx URLs still hit the mock.
 * Re-register after other `page.route` calls (Playwright matches last-registered routes first).
 */
export async function registerKansasGeneralLocationsCatalogMock(page: Page): Promise<void> {
  const locations = [...E2E_MOCK_KANSAS_GENERAL_LOCATIONS];
  const body = JSON.stringify({
    success: true,
    catalog: {
      states: { Kansas: locations },
      sheet_defaults: {},
    },
    states: [{ state: 'Kansas', locations }],
    sheet_defaults: [],
  });

  const handler = async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body,
      });
    } else {
      await route.continue();
    }
  };

  await page.route('**/api/general-locations**', handler);
  await page.route('**/general-locations**', handler);
  await page.route(
    (url) => url.pathname.toLowerCase().includes('general-locations'),
    handler,
  );
  // Some CI/proxy setups use full URLs Playwright’s glob misses; RegExp matches the request string.
  await page.route(/\/general-locations(\?|$|\/)/i, handler);
}

/** Re-applies catalog mock then selects {@link E2E_KANSAS_GENERAL_LOCATION} in the dialog. */
export async function pickKansasGeneralLocationInCreateTurtleDialog(
  page: Page,
  dialog: ReturnType<Page['getByRole']>,
): Promise<void> {
  await registerKansasGeneralLocationsCatalogMock(page);
  await fillGeneralLocationInCreateTurtleDialog(dialog, E2E_KANSAS_GENERAL_LOCATION);
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

  await sexSelect.scrollIntoViewIfNeeded();
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
