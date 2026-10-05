import { test, expect, type Page } from '@playwright/test';

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

test.describe('Research groups', () => {
  test('super admin creates a group, opens it and switches back', async ({ page }) => {
    test.setTimeout(90_000);
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

  test('main-group admin keeps the classic user management', async ({ page }) => {
    await login(page, process.env.E2E_ADMIN_EMAIL ?? 'admin@test.com', process.env.E2E_ADMIN_PASSWORD ?? 'testpassword123');
    // Main-group staff photograph the plastron
    await expect(page.getByTestId('shell-photo-hint')).toHaveAttribute('data-shell', 'plastron', { timeout: 15_000 });
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible({ timeout: 15_000 });
  });
});
