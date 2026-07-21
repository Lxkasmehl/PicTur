import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import {
  loginAsScopedStaff,
  loginAsStaff,
  grantLocationPermission,
  getTestImageBuffer,
  clickUploadPhotoButton,
} from './fixtures';

/**
 * Scoped-group match flow (PR-4).
 *
 * These read-only tests never mutate a shared seeded user — they only log in
 * (seeded `scoped-staff@test.com` in KansasTeam / area `Kansas/Topeka`, and the
 * global `staff@test.com`) and drive the match UI, so they are parallel-safe and
 * need no `serial` block.
 *
 * The upload+match is MOCKED (route-fulfilled), the way `admin-match.spec.ts` mocks
 * its match data: a real photo match against the VRAM cache is heavy and its
 * `scope_expanded` / per-candidate `in_scope` flags depend on live group areas +
 * data-dir contents, which would make the assertions nondeterministic. The scope
 * *dropdown* test, by contrast, relies on the REAL enriched `/auth/me` (so the
 * seeded scoped user's `areas` drive the filtering) and only mocks `/api/locations`.
 */

const SCOPE_SELECT = 'input[placeholder="Select state or location"]';

/** Mock GET /api/locations with the given folder list (state + State/Location paths). */
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

/**
 * Mock the admin/staff upload + the follow-up review-packet / sheets reads so the
 * match page renders deterministically. `scopeExpanded` / candidate `in_scope`
 * drive the read-only behaviour under test.
 */
async function mockMatchFlow(
  page: Page,
  opts: {
    requestId: string;
    scopeExpanded: boolean;
    match: { turtle_id: string; location: string; in_scope: boolean };
  },
): Promise<void> {
  const { requestId, scopeExpanded, match } = opts;

  await page.route('**/api/upload**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        request_id: requestId,
        uploaded_image_path: `Review_Queue/${requestId}/query.jpg`,
        photo_type: 'plastron',
        scope_expanded: scopeExpanded,
        matches: [
          {
            turtle_id: match.turtle_id,
            location: match.location,
            confidence: 0.82,
            file_path: '',
            filename: '',
            in_scope: match.in_scope,
          },
        ],
        message: 'Uploaded',
      }),
    });
  });

  await page.route(`**/api/review-queue/${requestId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        item: {
          request_id: requestId,
          uploaded_image: `Review_Queue/${requestId}/query.jpg`,
          metadata: { photo_type: 'plastron', scope_expanded: scopeExpanded },
          additional_images: [],
          candidates: [],
          status: 'matched',
          photo_type: 'plastron',
        },
      }),
    });
  });

  // Sheets reads fired by the match page (candidate summaries + on card-select) and
  // the available-sheets list. Benign fixed responses keep the flow deterministic.
  await page.route('**/api/sheets/sheets**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, sheets: ['Kansas', 'NebraskaCPBS'] }),
    });
  });
  await page.route('**/api/sheets/turtle/**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        exists: true,
        data: {
          primary_id: 'T1000000001',
          id: match.turtle_id,
          name: 'Scope E2E Turtle',
          sheet_name: match.location.split('/')[0],
          general_location: match.location.split('/').slice(1).join('/') || match.location,
        },
      }),
    });
  });
}

async function uploadPhoto(page: Page, name: string): Promise<void> {
  const fileInput = page.locator('input[type="file"]:not([capture])').first();
  await fileInput.setInputFiles({ name, mimeType: 'image/png', buffer: getTestImageBuffer() });
  await page.waitForSelector('button:has-text("Upload Photo")', { timeout: 5000 });
  await clickUploadPhotoButton(page);
}

async function openScopeOptions(page: Page): Promise<string[]> {
  const select = page.locator(SCOPE_SELECT);
  await expect(select).toBeVisible({ timeout: 15_000 });
  await select.click();
  await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 10_000 });
  return page.getByRole('option').allTextContents();
}

test.describe('Scoped-group match flow', () => {
  test('Scoped staff: scope dropdown shows only owned areas + Community + All locations', async ({
    page,
    isMobile,
  }) => {
    // Reading a portaled Mantine Select's options via getByRole('option') is unreliable
    // on the mobile projects (the option list renders in a portal the mobile viewport
    // doesn't surface to Playwright — see fixtures.ts selectComboboxOptionByIndex). The
    // scope-filtering logic is browser-agnostic and fully covered on the desktop projects.
    test.skip(!!isMobile, 'portaled Select options are not reliably enumerable on mobile');
    await mockLocations(page, [
      'Kansas',
      'Kansas/Topeka',
      'Kansas/Lawrence',
      'NebraskaCPBS',
      'Nebraska/Lincoln',
    ]);
    await loginAsScopedStaff(page);
    await page
      .getByText('Loading locations…')
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => {});

    const options = await openScopeOptions(page);
    const joined = options.join('\n');

    // Owned sheet (area is Kansas/Topeka, so the Kansas sheet is visible).
    expect(joined).toContain('Kansas');
    // Always-present shared entries.
    expect(joined).toContain('Community Turtles only');
    expect(joined).toContain('All locations');
    // Out-of-scope states must NOT appear.
    expect(options.some((o) => /Nebraska/i.test(o))).toBeFalsy();
  });

  test('Scoped staff: out-of-scope upload → read-only match page (writes disabled)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await mockLocations(page, ['Kansas', 'Kansas/Topeka', 'NebraskaCPBS']);
    await mockMatchFlow(page, {
      requestId: 'admin_e2e-scoped-oos',
      scopeExpanded: true,
      match: { turtle_id: 'F900', location: 'Nebraska', in_scope: false },
    });
    await loginAsScopedStaff(page);
    await grantLocationPermission(page);

    await uploadPhoto(page, 'scoped-oos-e2e.png');
    await expect(page).toHaveURL(/\/admin\/turtle-match\/admin_e2e-scoped-oos/, { timeout: 30_000 });

    // Read-only banner + out-of-scope candidate badge + disabled Create New Turtle.
    await expect(page.getByTestId('scope-alert')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('candidate-out-of-scope').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create New Turtle' })).toBeDisabled();

    // Selecting the candidate opens the detail view; the save/confirm write stays disabled.
    await page.locator('.mantine-Card-root').filter({ hasText: 'F900' }).first().click();
    await expect(
      page.getByRole('button', { name: /Save to Sheets & Confirm Match/ }),
    ).toBeDisabled({ timeout: 15_000 });
  });

  test('Scoped staff: in-scope upload → editable match page (no banner)', async ({ page }) => {
    test.setTimeout(60_000);
    await mockLocations(page, ['Kansas', 'Kansas/Topeka']);
    await mockMatchFlow(page, {
      requestId: 'admin_e2e-scoped-inscope',
      scopeExpanded: false,
      match: { turtle_id: 'F100', location: 'Kansas/Topeka', in_scope: true },
    });
    await loginAsScopedStaff(page);
    await grantLocationPermission(page);

    await uploadPhoto(page, 'scoped-inscope-e2e.png');
    await expect(page).toHaveURL(/\/admin\/turtle-match\/admin_e2e-scoped-inscope/, {
      timeout: 30_000,
    });

    await expect(page.getByRole('button', { name: 'Create New Turtle' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('scope-alert')).toHaveCount(0);
    await expect(page.getByTestId('candidate-out-of-scope')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create New Turtle' })).toBeEnabled();
  });

  test('Global staff: full dropdown + editable match page (regression)', async ({
    page,
    isMobile,
  }) => {
    test.setTimeout(60_000);
    await mockLocations(page, ['Kansas', 'Kansas/Topeka', 'NebraskaCPBS', 'Nebraska/Lincoln']);
    await mockMatchFlow(page, {
      requestId: 'admin_e2e-global-staff',
      scopeExpanded: false,
      match: { turtle_id: 'F200', location: 'NebraskaCPBS', in_scope: true },
    });
    await loginAsStaff(page);
    await page
      .getByText('Loading locations…')
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => {});

    // A global member is unfiltered: both states appear. The portaled-option read is
    // desktop-only (see the scoped dropdown test); on mobile we still exercise the
    // editable-match-page regression below, which is the load-bearing assertion.
    if (!isMobile) {
      const options = await openScopeOptions(page);
      const joined = options.join('\n');
      expect(joined).toContain('Kansas');
      expect(options.some((o) => /Nebraska/i.test(o))).toBeTruthy();
      // Close the dropdown before uploading.
      await page.keyboard.press('Escape');
    }

    await grantLocationPermission(page);
    await uploadPhoto(page, 'global-staff-e2e.png');
    await expect(page).toHaveURL(/\/admin\/turtle-match\/admin_e2e-global-staff/, {
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Create New Turtle' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('scope-alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create New Turtle' })).toBeEnabled();
  });
});
