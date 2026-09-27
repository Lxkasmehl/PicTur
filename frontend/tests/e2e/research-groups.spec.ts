import { test, expect, type Page } from '@playwright/test';
import { getTestImageBuffer } from './fixtures';

/**
 * Research groups (multi-tenancy): a super admin creates a database-backed group, defines a
 * region, uploads a carapace photo and creates the group's first turtle.
 *
 * The group is created with community uploads OFF so it never shows up in the public group
 * picker of the other specs (their header/navigation stays unchanged).
 */

const SUPER_ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? 'superadmin@test.com';
const SUPER_ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? 'testpassword123';

async function loginAsSuperAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(SUPER_ADMIN_EMAIL);
  await page.getByLabel('Password').fill(SUPER_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click({ noWaitAfter: true });
  await page.waitForURL('/', { timeout: 15_000 });
}

test.describe('Research groups', () => {
  test('super admin creates a group and records its first turtle', async ({ page }) => {
    test.setTimeout(120_000);
    const slug = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    await loginAsSuperAdmin(page);
    await page.goto('/platform/groups');
    await page.getByLabel('Name', { exact: true }).fill(`E2E Group ${slug}`);
    await page.getByLabel('URL name').fill(slug);
    const communitySwitch = page.getByLabel('Accept photos from the community');
    await page.getByText('Accept photos from the community').click();
    await expect(communitySwitch).not.toBeChecked();
    await page.getByTestId('platform-create-group').click();
    await expect(page.getByText(slug, { exact: true })).toBeVisible({ timeout: 15_000 });

    // Regions
    await page.goto(`/g/${slug}/regions`);
    await page.getByLabel('New region').fill('North Site');
    await page.getByTestId('org-add-region').click();
    await expect(page.locator('p', { hasText: /^North Site$/ })).toBeVisible();

    // Staff-style upload -> submission review
    await page.goto(`/g/${slug}`);
    await page.locator('[data-testid="org-upload-dropzone"] input[type="file"]').setInputFiles({
      name: 'e2e-carapace.png',
      mimeType: 'image/png',
      buffer: getTestImageBuffer(),
    });
    await page.getByTestId('org-upload-submit').click();
    await expect(page).toHaveURL(new RegExp(`/g/${slug}/review/\\d+`), { timeout: 60_000 });

    // Empty group: no candidates -> create the first turtle
    await page.getByTestId('org-create-turtle').click();
    await expect(page).toHaveURL(new RegExp(`/g/${slug}/turtles/\\d+`), { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'U1' })).toBeVisible();

    await page.goto(`/g/${slug}/turtles`);
    await expect(page.getByTestId('org-turtle-row')).toHaveCount(1);
  });

  test('main-group admin cannot open another group', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.E2E_ADMIN_EMAIL ?? 'admin@test.com');
    await page.getByLabel('Password').fill(process.env.E2E_ADMIN_PASSWORD ?? 'testpassword123');
    await page.getByRole('button', { name: 'Sign In' }).click({ noWaitAfter: true });
    await page.waitForURL('/', { timeout: 15_000 });
    await page.goto('/g/does-not-exist/turtles');
    await expect(page.getByTestId('org-gate-message')).toBeVisible();
    await expect(page.getByTestId('org-switcher')).toHaveCount(0);
  });
});
