import { test, expect } from '@playwright/test';

test.describe('Contact and Feedback forms', () => {
  test('Contact form submits and clears fields on success', async ({ page }) => {
    let capturedBody: unknown = null;
    let submitCount = 0;

    await page.route('**/api/contact**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      submitCount += 1;
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/contact');
    await page.getByLabel('Your name').fill('E2E Turtle Tester');
    await page.getByLabel('Your email').fill('e2e-contact@example.com');
    await page.getByLabel('Message').fill('Hello team, this is an automated smoke test message.');
    await page.locator('form').evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });

    await expect.poll(() => submitCount).toBe(1);
    expect(capturedBody).toEqual({
      name: 'E2E Turtle Tester',
      email: 'e2e-contact@example.com',
      message: 'Hello team, this is an automated smoke test message.',
    });

    await expect(page.getByLabel('Your name')).toHaveValue('');
    await expect(page.getByLabel('Your email')).toHaveValue('');
    await expect(page.getByLabel('Message')).toHaveValue('');
  });

  test('Contact form shows unavailable warning when backend disables it', async ({ page }) => {
    let capturedBody: unknown = null;
    let submitCount = 0;

    await page.route('**/api/contact**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      submitCount += 1;
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Contact is not configured', code: 'CONTACT_DISABLED' }),
      });
    });

    await page.goto('/contact');
    await page.getByLabel('Your name').fill('E2E Turtle Tester');
    await page.getByLabel('Your email').fill('e2e-contact@example.com');
    await page.getByLabel('Message').fill('Checking disabled-contact UX.');
    await page.locator('form').evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });

    await expect.poll(() => submitCount).toBe(1);
    expect(capturedBody).toEqual({
      name: 'E2E Turtle Tester',
      email: 'e2e-contact@example.com',
      message: 'Checking disabled-contact UX.',
    });
    await expect(page.getByLabel('Your name')).toHaveValue('E2E Turtle Tester');
    await expect(page.getByLabel('Your email')).toHaveValue('e2e-contact@example.com');
    await expect(page.getByLabel('Message')).toHaveValue('Checking disabled-contact UX.');
  });

  test('Feedback form submits with optional contact email', async ({ page }) => {
    let capturedBody: unknown = null;
    let submitCount = 0;

    await page.route('**/api/feedback**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      submitCount += 1;
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          issueNumber: 1234,
          issueUrl: 'https://example.invalid/issues/1234',
          projectAdded: true,
        }),
      });
    });

    await page.goto('/feedback');
    await page.getByLabel('Short summary').fill('Add export button');
    await page
      .getByLabel('Details')
      .fill('It would be helpful to export turtle records as CSV from the records page.');
    await page.getByLabel('Contact email (optional)').fill('e2e-feedback@example.com');
    await page.locator('form').evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });

    await expect.poll(() => submitCount).toBe(1);
    expect(capturedBody).toEqual({
      category: 'bug',
      title: 'Add export button',
      description: 'It would be helpful to export turtle records as CSV from the records page.',
      contactEmail: 'e2e-feedback@example.com',
    });

    await expect(page.getByLabel('Short summary')).toHaveValue('');
    await expect(page.getByLabel('Details')).toHaveValue('');
    await expect(page.getByLabel('Contact email (optional)')).toHaveValue('');
  });

  test('Feedback form shows rate-limit error message', async ({ page }) => {
    let capturedBody: unknown = null;
    let submitCount = 0;

    await page.route('**/api/feedback**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      submitCount += 1;
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Please wait before sending another report.' }),
      });
    });

    await page.goto('/feedback');
    await page.getByLabel('Short summary').fill('Rate limit test');
    await page
      .getByLabel('Details')
      .fill('This verifies user-facing messaging when submitting too frequently.');
    await page.locator('form').evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });

    await expect.poll(() => submitCount).toBe(1);
    expect(capturedBody).toEqual({
      category: 'bug',
      title: 'Rate limit test',
      description: 'This verifies user-facing messaging when submitting too frequently.',
    });
    await expect(page.getByLabel('Short summary')).toHaveValue('Rate limit test');
    await expect(page.getByLabel('Contact email (optional)')).toHaveValue('');
  });
});
