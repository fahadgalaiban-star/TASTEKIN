import { expect, test } from '@playwright/test';

// The sign-in screen must never offer "Continue with Google" unless the
// server actually has Google OAuth configured — it previously rendered
// unconditionally, sending users into a dead end.
test('Continue with Google is hidden when Google auth is not configured, shown when it is', async ({ page }) => {
  let googleAuthConfigured = false;
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: null, role: 'consumer', creator: null, subscribed: false, supportEmail: null, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('you-sign-in').click();
  await expect(page.getByRole('button', { name: 'Continue with Replit' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);

  googleAuthConfigured = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('you-sign-in').click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});
