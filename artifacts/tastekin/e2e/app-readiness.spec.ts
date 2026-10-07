import { expect, test, type Page } from '@playwright/test';

// Store-readiness honesty on the account surfaces, with /api/me mocked so
// each server-reported state can be exercised directly:
//  - "Forgot password?" never promises an email the server cannot send;
//  - Settings describes the password per sign-in method;
//  - notification controls appear only when the server reports the flag on;
//  - the public /support page shows only the configured SUPPORT_EMAIL.

type MeOptions = {
  authenticated?: boolean;
  language?: 'en' | 'ar';
  supportEmail?: string | null;
  authProvider?: 'password' | 'google' | 'replit' | null;
  passwordResetAvailable?: boolean;
  featureFlags?: Record<string, boolean>;
};

function mePayload(options: MeOptions) {
  const base = {
    role: 'consumer', creator: null, isAdmin: false, notifyPush: true, notifyEmail: true,
    supportEmail: options.supportEmail ?? null, passwordResetAvailable: options.passwordResetAvailable ?? false,
    needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: options.featureFlags ?? {},
  };
  return options.authenticated
    ? { ...base, user: { id: 'readiness-user', email: 'member@tastekin.test' }, language: options.language ?? 'en', authProvider: options.authProvider ?? 'password' }
    : { ...base, user: null, language: null };
}

async function mockSession(page: Page, options: MeOptions) {
  // No unmatched request may reach a real API during these checks.
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Unmocked test endpoint' }) }));
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store, max-age=0' }, body: JSON.stringify(mePayload(options)) });
  });
}

async function openForgotPassword(page: Page, ar = false) {
  await page.goto(ar ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('you-sign-in').click();
  await page.getByRole('button', { name: ar ? 'نسيت كلمة المرور؟' : 'Forgot password?' }).click();
}

test.describe('forgot password is honest about email delivery', () => {
  test('without an email provider the screen explains no link can be sent and offers no form; with no support address it says so', async ({ page }) => {
    await mockSession(page, { passwordResetAvailable: false, supportEmail: null });
    await openForgotPassword(page);
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    const notice = page.getByTestId('forgot-password-unavailable');
    await expect(notice).toContainText('Password reset by email is not available yet');
    await expect(notice).not.toContainText('send you a link');
    await expect(page.getByTestId('forgot-password-no-support')).toHaveText('Support contact is not configured yet.');
    await expect(page.getByTestId('forgot-password-form')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send reset link' })).toHaveCount(0);
    await expect(page.getByTestId('forgot-password-support')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('with a configured support address the unavailable notice links to it, in English and Arabic', async ({ page }) => {
    await mockSession(page, { passwordResetAvailable: false, supportEmail: 'help@example.test' });
    await openForgotPassword(page);
    const support = page.getByTestId('forgot-password-support');
    await expect(support).toHaveText('Contact support');
    await expect(support).toHaveAttribute('href', 'mailto:help@example.test');
    await expect(page.getByTestId('forgot-password-form')).toHaveCount(0);

    await openForgotPassword(page, true);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('forgot-password-unavailable')).toContainText('غير متاحة بعد');
    await expect(page.getByTestId('forgot-password-support')).toHaveAttribute('href', 'mailto:help@example.test');
    await expect(page.getByRole('button', { name: 'إرسال رابط إعادة التعيين' })).toHaveCount(0);
  });

  test('only when the server reports reset emails as available does the email form appear', async ({ page }) => {
    await mockSession(page, { passwordResetAvailable: true });
    await openForgotPassword(page);
    await expect(page.getByTestId('forgot-password-form')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
    await expect(page.getByTestId('forgot-password-unavailable')).toHaveCount(0);
  });
});

test.describe('password settings reflect the sign-in method', () => {
  for (const [provider, expected] of [['password', 'Set for this account'], ['google', 'Managed by Google'], ['replit', 'Managed by Replit']] as const) {
    test(`an account that signs in with ${provider} sees "${expected}"`, async ({ page }) => {
      await mockSession(page, { authenticated: true, authProvider: provider });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.getByTestId('open-settings-topbar').click();
      await expect(page.getByTestId('settings-password-status')).toHaveText(expected);
    });
  }

  test('a signed-out visitor sees "Not available", and the Arabic copy follows the provider', async ({ page }) => {
    await mockSession(page, { authenticated: false });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('open-settings-topbar').click();
    await expect(page.getByTestId('settings-password-status')).toHaveText('Not available');

    await mockSession(page, { authenticated: true, authProvider: 'google', language: 'ar' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('open-settings-topbar').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('settings-password-status')).toHaveText('تُدار عبر Google');
  });
});

test.describe('notification controls stay hidden until the flag is on', () => {
  test('no Notifications section when the server omits or disables the flag', async ({ page }) => {
    for (const featureFlags of [{}, { notification_preferences: false }]) {
      await mockSession(page, { authenticated: true, featureFlags });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.getByTestId('open-settings-topbar').click();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expect(page.getByTestId('settings-notifications')).toHaveCount(0);
      await expect(page.getByText('Push notifications')).toHaveCount(0);
      await expect(page.getByText('Notification preferences are temporarily unavailable.')).toHaveCount(0);
    }
  });

  test('the controls appear only when the server reports the flag enabled', async ({ page }) => {
    await mockSession(page, { authenticated: true, featureFlags: { notification_preferences: true } });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('open-settings-topbar').click();
    await expect(page.getByTestId('settings-notifications')).toBeVisible();
    await expect(page.getByText('Push notifications')).toBeVisible();
    await expect(page.getByText('Email updates')).toBeVisible();
  });
});

test.describe('public /support page', () => {
  test('is reachable signed out by plain URL and shows exactly the configured support address', async ({ page }) => {
    await mockSession(page, { supportEmail: 'help@example.test' });
    await page.goto('/support', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible();
    const link = page.getByTestId('support-email');
    await expect(link).toHaveText('help@example.test');
    await expect(link).toHaveAttribute('href', 'mailto:help@example.test');
    await expect(page.getByTestId('support-unconfigured')).toHaveCount(0);
    // Helpful pages route within the app.
    await page.getByTestId('support-privacy').click();
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  });

  test('says support is not configured when SUPPORT_EMAIL is unset, and never invents an address', async ({ page }) => {
    await mockSession(page, { supportEmail: null });
    await page.goto('/support', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('support-unconfigured')).toHaveText('Support contact is not configured yet.');
    await expect(page.getByTestId('support-email')).toHaveCount(0);
    await expect(page.getByTestId('support-page').locator('a[href^="mailto:"]')).toHaveCount(0);
  });

  test('renders in Arabic/RTL and is linked from Settings → Help & Support', async ({ page }) => {
    await mockSession(page, { authenticated: true, language: 'ar', supportEmail: 'help@example.test' });
    await page.goto('/support', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الدعم' })).toBeVisible();
    await expect(page.getByTestId('support-email')).toHaveText('help@example.test');

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('open-settings-topbar').click();
    await page.getByTestId('settings-support-page').click();
    await expect(page.getByRole('heading', { name: 'الدعم' })).toBeVisible();
    await expect(page.getByTestId('support-email')).toHaveAttribute('href', 'mailto:help@example.test');
  });
});
