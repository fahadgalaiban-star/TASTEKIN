import { expect, test, type Page } from '@playwright/test';

// Show/hide password on every password field: sign-in/sign-up and the
// reset-password form, in English and Arabic (RTL mirrors the eye).

async function signedOut(page: Page, language: 'en' | 'ar' = 'en') {
  await page.route('**/api/me', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      user: null, role: 'consumer', creator: null, isAdmin: false, language,
      notifyPush: true, notifyEmail: true, supportEmail: null,
      needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: {},
    }),
  }));
}

async function openSignIn(page: Page, language: 'en' | 'ar' = 'en') {
  await page.goto(language === 'ar' ? '/?lang=ar' : '/');
  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-sign-in').click();
  await expect(page.getByRole('heading', { name: language === 'ar' ? 'تسجيل الدخول' : 'Sign in' })).toBeVisible();
}

for (const language of ['en', 'ar'] as const) {
  test(`the sign-in password field has a show/hide toggle (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signedOut(page, language);
    await openSignIn(page, language);
    const field = page.getByTestId('auth-password');
    const toggle = page.getByTestId('auth-password-toggle');
    await expect(field).toHaveAttribute('type', 'password');
    // The label stays the plain caption, so label-based lookups keep working.
    await expect(page.getByLabel(language === 'ar' ? 'كلمة المرور' : 'Password', { exact: true })).toHaveAttribute('type', 'password');
    await expect(toggle).toHaveAccessibleName(language === 'ar' ? 'إظهار كلمة المرور' : 'Show password');

    await field.fill('secret-password-1');
    await toggle.click();
    await expect(field).toHaveAttribute('type', 'text');
    await expect(field).toHaveValue('secret-password-1');
    await expect(toggle).toHaveAccessibleName(language === 'ar' ? 'إخفاء كلمة المرور' : 'Hide password');
    await toggle.click();
    await expect(field).toHaveAttribute('type', 'password');

    // The eye sits inside the field on its trailing edge: right in LTR, left in RTL.
    const input = await field.boundingBox();
    const eye = await toggle.boundingBox();
    expect(input && eye).toBeTruthy();
    if (language === 'ar') expect(eye!.x).toBeLessThan(input!.x + input!.width / 2);
    else expect(eye!.x).toBeGreaterThan(input!.x + input!.width / 2);
    expect(eye!.y + eye!.height / 2).toBeGreaterThan(input!.y);
    expect(eye!.y + eye!.height / 2).toBeLessThan(input!.y + input!.height);
    await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
  });
}

test('the reset-password field has the same toggle', async ({ page }) => {
  await signedOut(page);
  await page.goto('/reset-password?token=test-token');
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  const field = page.getByTestId('reset-password');
  await expect(field).toHaveAttribute('type', 'password');
  await page.getByTestId('reset-password-toggle').click();
  await expect(field).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
});

test('the sign-up form keeps the toggle and still submits the password', async ({ page }) => {
  await signedOut(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/auth/signup', async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ user: { id: 'new', email: 'new@tastekin.test' } }) });
  });
  await openSignIn(page);
  await page.getByRole('button', { name: "Don't have an account? Sign up" }).click();
  await page.getByLabel('Email').fill('new@tastekin.test');
  await page.getByTestId('auth-password').fill('longenoughpassword');
  await page.getByTestId('auth-password-toggle').click();
  await expect(page.getByTestId('auth-password')).toHaveAttribute('type', 'text');
  await page.getByTestId('signup-terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ password: 'longenoughpassword' });
});
