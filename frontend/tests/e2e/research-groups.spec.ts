import { test, expect, type Page } from '@playwright/test';
import { clickUploadPhotoButton, getTestImageBuffer, loginAsCommunity } from './fixtures';

/**
 * Research groups (multi-tenancy): a super admin creates a database-backed group and opens it.
 * Every group uses the same pages as the main group; "User Management" shows the group's members.
 *
 * The group is created with community uploads OFF so it never shows up in the public group
 * picker of the other specs (their header/navigation stays unchanged).
 */

const SUPER_ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? 'superadmin@test.com';
const SUPER_ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? 'testpassword123';

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click({ noWaitAfter: true });
  await page.waitForURL('/', { timeout: 15_000 });
}

/** Logs in as super admin, creates a closed group and opens it (lands on its members page). */
async function createAndOpenGroup(page: Page): Promise<string> {
  const slug = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const name = `E2E Group ${slug}`;

  await login(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  await page.goto('/platform/groups');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('URL name').fill(slug);
  await page.getByText('Accept photos from the community').click();
  await expect(page.getByLabel('Accept photos from the community')).not.toBeChecked();
  await page.getByTestId('platform-create-group').click();
  await expect(page.getByText(slug, { exact: true })).toBeVisible({ timeout: 15_000 });

  // Open the group: same User Management route, now showing the group's members
  await page.getByRole('row', { name: new RegExp(slug) }).getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole('heading', { name: `Members of ${name}` })).toBeVisible({ timeout: 15_000 });
  return name;
}

test.describe('Research groups', () => {
  test('admins choose how their group records locations', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndOpenGroup(page);
    await page.goto('/admin/locations');
    const setup = page.getByTestId('location-structure');
    await expect(setup).toBeVisible({ timeout: 15_000 });

    // One location: nothing to manage, the group's single program is set up automatically
    await setup.getByText('One location').click();
    await expect(page.getByText(/Nothing else to set up/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Study Area', { exact: true })).toBeVisible();

    // Several areas: the location becomes the first area; more can be added
    await setup.getByText('Several areas').click();
    await expect(page.getByRole('heading', { name: 'Areas' })).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder('New area name').fill('North Pond');
    await page.getByRole('button', { name: 'Add area' }).click();
    await expect(page.getByText('North Pond', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Study Area', { exact: true })).toBeVisible();

    // Several programs: the full view, with the program holding both areas
    await setup.getByText('Several programs').click();
    await expect(page.getByRole('heading', { name: 'Selectable Locations' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Turtles', { exact: true })).toBeVisible();
  });

  test('super admins see the role explanation and the other super admins', async ({ page }) => {
    await login(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await page.goto('/platform/groups');
    await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Creates research groups and names their first admin')).toBeVisible();
    const list = page.getByTestId('super-admin-list');
    await expect(list.getByText(SUPER_ADMIN_EMAIL)).toBeVisible({ timeout: 15_000 });
    // The only super admin cannot remove themselves
    await expect(list.getByRole('button', { name: `Remove super admin ${SUPER_ADMIN_EMAIL}` })).toBeDisabled();
  });

  test('super admin creates a group, opens it and switches back', async ({ page }) => {
    test.setTimeout(90_000);
    const name = await createAndOpenGroup(page);

    // The classic pages work for the group (empty to start with)
    await page.goto('/admin/locations');
    await expect(page.getByText('No selectable location programs configured.')).toBeVisible({ timeout: 15_000 });

    // Programs need no existing tab: a selectable one with a first location, and a fixed one
    await page.getByRole('button', { name: 'Add program' }).click();
    await page.getByRole('dialog').getByLabel('Program name').fill('River Survey');
    await page.getByRole('dialog').getByRole('button', { name: 'Add program' }).click();
    await expect(page.getByText('River Survey', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder('New location name').fill('North Bank');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('North Bank', { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Add fixed program' }).click();
    await page.getByRole('dialog').getByLabel('Program name').fill('Pond Study');
    await page.getByRole('dialog').getByLabel('Fixed General Location').fill('Pond');
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('cell', { name: 'Pond Study' })).toBeVisible({ timeout: 15_000 });

    // Research groups photograph the carapace
    await page.goto('/');
    await expect(page.getByTestId('shell-photo-hint')).toHaveAttribute('data-shell', 'carapace', { timeout: 15_000 });

    // Switch back to the main group
    await page.getByTestId('org-switcher').first().click();
    await page.getByRole('option').first().click();
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: `Members of ${name}` })).toHaveCount(0);
  });

  test('super admins delete an empty group after typing its URL name', async ({ page }) => {
    test.setTimeout(90_000);
    const name = await createAndOpenGroup(page);
    const slug = name.replace('E2E Group ', '');
    await page.goto('/platform/groups');
    await page.getByTestId(`platform-delete-group-${slug}`).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/holds no turtles, records or photos/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId('delete-group-submit')).toBeDisabled();
    await dialog.getByTestId('delete-group-confirm-slug').fill(slug);
    await dialog.getByTestId('delete-group-submit').click();
    await expect(page.getByText('Research group deleted')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(slug, { exact: true })).toHaveCount(0);
  });

  test('group admins choose the turtle data fields and add their own', async ({ page }) => {
    test.setTimeout(90_000);
    await createAndOpenGroup(page);
    const panel = page.getByTestId('group-data-fields');
    await expect(panel.getByTestId('turtle-column-species')).toBeChecked({ timeout: 15_000 });
    // required fields cannot be turned off
    await expect(panel.getByTestId('turtle-column-sex')).toBeDisabled();
    await panel.getByTestId('turtle-column-species').click();
    await panel.getByTestId('custom-column-add').click();
    await panel.getByTestId('custom-column-label-0').fill('Eye color');
    await panel.getByTestId('group-data-fields-save').click();
    await expect(page.getByText('Data fields saved')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(panel.getByTestId('custom-column-label-0')).toHaveValue('Eye color', { timeout: 15_000 });
    await expect(panel.getByTestId('turtle-column-species')).not.toBeChecked();
  });

  test('community photo sent to all groups reaches a group with its own fields; deleting it needs the full name', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const slug = `e2e-all-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const name = `E2E Open Group ${slug}`;

    // Super admin creates a group that accepts community photos and picks its own data fields
    await login(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    await page.goto('/platform/groups');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('URL name').fill(slug);
    await expect(page.getByLabel('Accept photos from the community')).toBeChecked();
    await page.getByRole('radio', { name: 'Choose fields and add our own' }).check();
    await page.getByTestId('turtle-column-species').click({ timeout: 15_000 });
    await expect(page.getByTestId('turtle-column-species')).not.toBeChecked();
    await page.getByTestId('custom-column-add').click();
    await page.getByTestId('custom-column-label-0').fill('Eye color');
    await page.getByTestId('platform-create-group').click();
    await expect(page.getByText(slug, { exact: true })).toBeVisible({ timeout: 15_000 });

    // Each step waits at most 60s, so a failure still leaves time to delete the group below
    try {
      // A community member does not know the group and sends the photo to all of them
      const community = await browser.newContext();
      const cpage = await community.newPage();
      try {
        await loginAsCommunity(cpage);
        const picker = cpage.getByTestId('upload-group-select');
        await expect(picker).toBeVisible({ timeout: 15_000 });
        await picker.click();
        await cpage.getByRole('option', { name: /^All research groups/ }).click();
        await expect(picker).toHaveValue(/^All research groups/);
        await cpage.locator('input[type="file"]:not([capture])').first().setInputFiles({
          name: `${slug}.png`,
          mimeType: 'image/png',
          buffer: getTestImageBuffer(),
        });
        await clickUploadPhotoButton(cpage);
        await expect(cpage.getByTestId('upload-success-alert')).toBeVisible({ timeout: 60_000 });
      } finally {
        await community.close();
      }

      // The group got its own copy, marked as sent to all groups
      await page.getByRole('row', { name: new RegExp(slug) }).getByRole('button', { name: 'Open' }).click();
      await expect(page.getByRole('heading', { name: `Members of ${name}` })).toBeVisible({ timeout: 15_000 });
      await page.goto('/admin/turtle-records');
      await page.getByRole('tab', { name: /Review Queue/ }).click();
      const queue = page.getByRole('tabpanel', { name: /Review Queue/ });
      await expect(queue.getByTestId('review-shared-badge')).toHaveCount(1, { timeout: 30_000 });
      await expect(queue.getByTestId('review-upload-source-badge')).toHaveText('Community upload');

      // Its turtle form shows the group's own field, not the one it turned off
      await queue.getByTestId('review-shared-badge').click();
      await page.getByRole('button', { name: 'Create New Turtle' }).first().click({ timeout: 60_000 });
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel('Eye color')).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByLabel('Species', { exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
    } finally {
      // The group now holds data: deleting it needs the URL name and the full name
      await page.goto('/platform/groups');
      await page.getByTestId(`platform-delete-group-${slug}`).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('This group still holds data')).toBeVisible({ timeout: 15_000 });
      await dialog.getByTestId('delete-group-confirm-slug').fill(slug);
      await expect(dialog.getByTestId('delete-group-submit')).toBeDisabled();
      await dialog.getByTestId('delete-group-confirm-name').fill(name);
      await dialog.getByTestId('delete-group-submit').click();
      await expect(page.getByText('Research group deleted')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(slug, { exact: true })).toHaveCount(0);
    }
  });

  test('main-group admin keeps the classic user management', async ({ page }) => {
    await login(page, process.env.E2E_ADMIN_EMAIL ?? 'admin@test.com', process.env.E2E_ADMIN_PASSWORD ?? 'testpassword123');
    // Main-group staff photograph the plastron
    await expect(page.getByTestId('shell-photo-hint')).toHaveAttribute('data-shell', 'plastron', { timeout: 15_000 });
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible({ timeout: 15_000 });
  });
});
