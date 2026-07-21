import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { loginAsAdmin, loginAsStaff, loginAsTeamLead, loginAsScopedStaff } from './fixtures';

// Both flows below mutate the single seeded unassigned-community user
// (unassigned@test.com): the group flow moves it into a group and back out; the
// team-lead flow claims/promotes/demotes/releases it. They MUST NOT run
// concurrently (fullyParallel would otherwise race them across workers on the same
// user), so the mutating tests share one `serial` describe — guaranteeing they run
// in order on a single worker and each restores the user before the next begins.
// The redirect tests touch no shared state and stay in their own parallel-safe block.

const UNASSIGNED_USER = process.env.E2E_UNASSIGNED_EMAIL ?? 'unassigned@test.com';
const TEAMLEAD_EMAIL = process.env.E2E_TEAMLEAD_EMAIL ?? 'teamlead@test.com';
const SCOPED_STAFF_EMAIL = process.env.E2E_SCOPED_STAFF_EMAIL ?? 'scoped-staff@test.com';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@test.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'testpassword123';
const GLOBAL_STAFF_EMAIL = process.env.E2E_STAFF_EMAIL ?? 'staff@test.com';
const AUTH_API = process.env.E2E_AUTH_URL ?? 'http://localhost:3001/api';

/**
 * Force the shared seeded user back to community + Unassigned, and drop any leftover
 * E2E-Team-* groups, via the admin API. Both flows below need the user to START as an
 * unassigned community member; a prior interrupted run could leave it in a group. This
 * makes the suite idempotent against a persistent (non-reseeded) backend.
 */
async function resetSharedState(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const login = await request.post(`${AUTH_API}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const token = (await login.json()).token as string;
  const headers = { Authorization: `Bearer ${token}` };

  const users = (await (await request.get(`${AUTH_API}/admin/users`, { headers })).json()).users as Array<{
    id: number;
    email: string;
  }>;
  const target = users.find((u) => u.email === UNASSIGNED_USER);
  if (target) {
    await request.patch(`${AUTH_API}/admin/users/${target.id}/membership`, {
      headers,
      data: { group_id: null },
    });
    await request.patch(`${AUTH_API}/admin/users/${target.id}/role`, {
      headers,
      data: { role: 'community' },
    });
  }

  const groups = (await (await request.get(`${AUTH_API}/admin/groups`, { headers })).json())
    .groups as Array<{ id: number; name: string }>;
  for (const g of groups.filter((g) => /^E2E-Team-/.test(g.name))) {
    await request.delete(`${AUTH_API}/admin/groups/${g.id}`, { headers });
  }
}

/** The seeded scoped group the team lead runs. */
const TEAM_GROUP_NAME = 'KansasTeam';

/** A deterministic area list so the assignment step never depends on the live backend's data dir. */
const MOCK_AREAS = ['Kansas/Topeka', 'Nebraska/Lincoln'];
const AREA_TO_ASSIGN = MOCK_AREAS[0];

async function mockLocations(page: Page): Promise<void> {
  const handler = async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, locations: MOCK_AREAS }),
      });
    } else {
      await route.continue();
    }
  };
  await page.route('**/api/locations**', handler);
  await page.route('**/locations', handler);
}

test.describe('Staff groups — access redirects', () => {
  test('Staff is redirected from Group Management to home', async ({ page }) => {
    await loginAsStaff(page);
    await page.goto('/admin/groups');
    await expect(page).toHaveURL('/');
  });

  test('Scoped staff (non-lead) is redirected from My Team to home', async ({ page }) => {
    await loginAsScopedStaff(page);
    await page.goto('/admin/my-team');
    await expect(page).toHaveURL('/');
  });
});

// Serial: these two tests mutate the same seeded user and must not overlap.
test.describe.serial('Staff groups — management flows', () => {
  // Idempotent precondition: start each flow with the shared user unassigned + community
  // and no leftover E2E groups, so a re-run against a persistent backend is deterministic.
  test.beforeEach(async ({ request }) => {
    await resetSharedState(request);
  });


  test('Admin creates a scoped group, assigns an area, moves a user in, and cannot delete it while non-empty', async ({
    page,
  }) => {
    // Wide viewport keeps nav in the header and tables un-scrolled; avoids flaky drawer interactions.
    await page.setViewportSize({ width: 1440, height: 900 });
    page.on('dialog', (dialog) => dialog.accept());
    await mockLocations(page);

    await loginAsAdmin(page);

    const groupName = `E2E-Team-${Date.now()}`;

    // --- Create a scoped Sub-Area group ------------------------------------------------
    await page.goto('/admin/groups');
    await expect(page.getByRole('heading', { name: 'Group Management' })).toBeVisible();

    await page.getByLabel('Create a Sub-Area group').fill(groupName);
    const createResp = page.waitForResponse(
      (r) => r.url().includes('/admin/groups') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    expect((await createResp).ok()).toBeTruthy();

    // Group row + its area card should now exist.
    await expect(page.locator('tr', { hasText: groupName })).toBeVisible();
    const areaCard = page.getByTestId(`area-card-${groupName}`);
    await expect(areaCard).toBeVisible();

    // --- Assign an area from the (mocked) locations list -------------------------------
    await areaCard.locator('input:not([type="hidden"])').first().click();
    await page.getByRole('option', { name: AREA_TO_ASSIGN }).click();
    const areasResp = page.waitForResponse(
      (r) => /\/admin\/groups\/\d+\/areas/.test(r.url()) && r.request().method() === 'PUT',
    );
    await areaCard.getByRole('button', { name: 'Save areas' }).click();
    expect((await areasResp).ok()).toBeTruthy();

    // --- Move an unassigned user into the group via User Management --------------------
    await page.goto('/admin/users');
    const unassignedSection = page.getByTestId('unassigned-users-section');
    await expect(unassignedSection).toBeVisible();
    // Scope the Move Select to its section: Mantine gives the portaled options listbox the
    // same aria-label as the input, so a page-level getByLabel would match both. The listbox
    // portals to document.body (outside this section), so scoping resolves to the input alone.
    const moveSelect = unassignedSection.getByLabel(`Move ${UNASSIGNED_USER} to a group`);
    await moveSelect.click();
    const moveResp = page.waitForResponse(
      (r) => /\/admin\/users\/\d+\/membership/.test(r.url()) && r.request().method() === 'PATCH',
    );
    await page.getByRole('option', { name: groupName }).click();
    expect((await moveResp).ok()).toBeTruthy();

    // --- Member count updates to 1 ----------------------------------------------------
    await page.goto('/admin/groups');
    await expect(page.getByTestId(`group-members-${groupName}`)).toHaveText('1');

    // --- Delete is blocked while the group has members --------------------------------
    await page.getByRole('button', { name: `Delete ${groupName}` }).click();
    await expect(page.getByText(/reassign first/i)).toBeVisible();
    // Group still present.
    await expect(page.locator('tr', { hasText: groupName })).toBeVisible();

    // --- Cleanup: release the user, then delete the now-empty group -------------------
    // The user is now in the group, so their Move Select is in the "by role" section (not
    // Unassigned). Scope to it so getByLabel doesn't also match the portaled options listbox.
    await page.goto('/admin/users');
    const backSelect = page
      .getByTestId('users-by-role-section')
      .getByLabel(`Move ${UNASSIGNED_USER} to a group`);
    await backSelect.click();
    const backResp = page.waitForResponse(
      (r) => /\/admin\/users\/\d+\/membership/.test(r.url()) && r.request().method() === 'PATCH',
    );
    await page.getByRole('option', { name: 'Unassigned' }).click();
    expect((await backResp).ok()).toBeTruthy();

    await page.goto('/admin/groups');
    const delResp = page.waitForResponse(
      (r) => /\/admin\/groups\/\d+$/.test(r.url()) && r.request().method() === 'DELETE',
    );
    await page.getByRole('button', { name: `Delete ${groupName}` }).click();
    expect((await delResp).ok()).toBeTruthy();
    await expect(page.locator('tr', { hasText: groupName })).toHaveCount(0);
  });

  test('Team lead sees only their own group and can claim, promote, and demote a member', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    page.on('dialog', (dialog) => dialog.accept());

    await loginAsTeamLead(page);
    await page.goto('/admin/my-team');

    // --- Own group + members only -----------------------------------------------------
    // Scope to the members table: the lead's own email also renders in the nav header, so a
    // page-level exact getByText for TEAMLEAD_EMAIL would match twice.
    await expect(page.getByRole('heading', { name: 'My Team' })).toBeVisible();
    await expect(page.getByRole('heading', { name: TEAM_GROUP_NAME })).toBeVisible();
    const membersTable = page.getByTestId('team-members-table');
    // Presence by row: the lead's own row carries a "you" badge in the email cell, so an
    // exact getByText on the email would miss it. Row hasText tolerates the badge; the full
    // emails are unambiguous per row.
    await expect(membersTable.locator('tr').filter({ hasText: SCOPED_STAFF_EMAIL })).toBeVisible();
    await expect(membersTable.locator('tr').filter({ hasText: TEAMLEAD_EMAIL })).toBeVisible();
    // A lead never sees other groups' members (Primary staff) or admins. Exact match so
    // 'staff@test.com' does not substring-match 'scoped-staff@test.com'.
    await expect(membersTable.getByText(ADMIN_EMAIL, { exact: true })).toHaveCount(0);
    await expect(membersTable.getByText(GLOBAL_STAFF_EMAIL, { exact: true })).toHaveCount(0);

    // --- Claim an unassigned community user ------------------------------------------
    await page.getByLabel('Email').fill(UNASSIGNED_USER);
    const claimResp = page.waitForResponse(
      (r) => r.url().includes('/lead/members/claim') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Claim', exact: true }).click();
    expect((await claimResp).ok()).toBeTruthy();

    const memberRow = page.locator('tr', { hasText: UNASSIGNED_USER });
    await expect(memberRow).toBeVisible();
    await expect(memberRow.getByText('Community', { exact: true })).toBeVisible();

    // --- Promote up the ladder (community -> staff) ----------------------------------
    const promoteResp = page.waitForResponse(
      (r) => /\/lead\/members\/\d+\/rank/.test(r.url()) && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: `Promote ${UNASSIGNED_USER}` }).click();
    expect((await promoteResp).ok()).toBeTruthy();
    await expect(
      page.locator('tr', { hasText: UNASSIGNED_USER }).getByText('Staff', { exact: true }),
    ).toBeVisible();

    // --- Demote back (staff -> community) --------------------------------------------
    const demoteResp = page.waitForResponse(
      (r) => /\/lead\/members\/\d+\/rank/.test(r.url()) && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: `Demote ${UNASSIGNED_USER}` }).click();
    expect((await demoteResp).ok()).toBeTruthy();
    await expect(
      page.locator('tr', { hasText: UNASSIGNED_USER }).getByText('Community', { exact: true }),
    ).toBeVisible();

    // --- Cleanup: release the claimed user back to Unassigned ------------------------
    const releaseResp = page.waitForResponse(
      (r) => /\/lead\/members\/\d+$/.test(r.url()) && r.request().method() === 'DELETE',
    );
    await page.getByRole('button', { name: `Release ${UNASSIGNED_USER}` }).click();
    expect((await releaseResp).ok()).toBeTruthy();
    await expect(page.locator('tr', { hasText: UNASSIGNED_USER })).toHaveCount(0);
  });
});
