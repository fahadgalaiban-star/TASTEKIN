import { expect, test } from '@playwright/test';

// The sign-in screen must never offer "Continue with Google" unless the
// server actually has Google OAuth configured — it previously rendered
// unconditionally, sending users into a dead end.
test('Continue with Google is hidden when Google auth is not configured, shown when it is', async ({ page }) => {
  let googleAuthConfigured = false;
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: null, role: 'consumer', creator: null, supportEmail: null, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('you-sign-in').click();
  // No provider available: email/password only, no "or" divider either.
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.locator('.auth-divider')).toHaveCount(0);

  googleAuthConfigured = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('you-sign-in').click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.locator('.auth-divider')).toBeVisible();
});

// "Continue with Replit" is an operator/dev sign-in. Regular members never
// see it: it renders only when the server reports the replit_sign_in flag
// (replitAuthAvailable). The /api/login route itself is not gated.
for (const language of ['en', 'ar'] as const) {
  test(`Continue with Replit is hidden by default and shown only with replitAuthAvailable (${language})`, async ({ page }) => {
    let replitAuthAvailable = false;
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ user: null, role: 'consumer', creator: null, supportEmail: null, language, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, replitAuthAvailable }),
      });
    });
    const label = language === 'ar' ? 'متابعة عبر Replit' : 'Continue with Replit';

    await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-you').click();
    await page.getByTestId('you-sign-in').click();
    await expect(page.getByLabel(language === 'ar' ? 'البريد الإلكتروني' : 'Email')).toBeVisible();
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);
    await expect(page.getByTestId('auth-replit')).toHaveCount(0);

    replitAuthAvailable = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-you').click();
    await page.getByTestId('you-sign-in').click();
    await expect(page.getByRole('button', { name: label })).toBeVisible();
    await expect(page.locator('.auth-divider')).toBeVisible();
  });
}
