import { expect, test, type Page } from '@playwright/test';

// Settings → Account → "Set a password" for a Replit/Google-provider account.
// Shown only to a signed-in provider account without a password; posts to
// /api/auth/set-password with the session; afterwards the status reads
// "Set for this account". Never offered on the sign-in screen.

type Provider = 'password' | 'google' | 'replit';

async function session(page: Page, { provider, passwordSet, language = 'en' }: { provider: Provider; passwordSet: boolean; language?: 'en' | 'ar' }) {
  const state = { passwordSet };
  await page.route('**/api/me', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      user: { id: 'replit-sub-1', email: 'dark.admin@example.test' }, role: 'consumer', creator: null, isAdmin: true, language,
      notifyPush: true, notifyEmail: true, supportEmail: null, authProvider: provider, passwordSet: state.passwordSet, passwordResetAvailable: false,
      needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: {},
    }),
  }));
  return state;
}

async function openSettings(page: Page, language: 'en' | 'ar' = 'en') {
  await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('open-settings-topbar').click();
  await expect(page.getByTestId('settings-password-status')).toBeVisible();
}

for (const language of ['en', 'ar'] as const) {
  test(`a Replit account without a password can set one from Settings (${language})`, async ({ page }) => {
    const state = await session(page, { provider: 'replit', passwordSet: false, language });
    const bodies: Record<string, unknown>[] = [];
    await page.route('**/api/auth/set-password', async (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      state.passwordSet = true;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, authProvider: 'replit', passwordSet: true }) });
    });
    await openSettings(page, language);
    await expect(page.getByTestId('settings-password-status')).toHaveText(language === 'ar' ? 'تُدار عبر Replit' : 'Managed by Replit');
    await page.getByTestId('settings-set-password').click();
    const form = page.getByTestId('settings-set-password-form');
    await expect(form).toContainText('dark.admin@example.test');

    // Mismatch is caught on the client, nothing is sent.
    await page.getByTestId('set-password').fill('a-long-password-1');
    await page.getByTestId('set-password-confirm').fill('a-different-one-2');
    await form.getByRole('button', { name: language === 'ar' ? 'حفظ كلمة المرور' : 'Save password' }).click();
    await expect(form.getByRole('alert')).toHaveText(language === 'ar' ? 'كلمتا المرور غير متطابقتين.' : 'The two passwords do not match.');
    expect(bodies).toHaveLength(0);

    await page.getByTestId('set-password-confirm').fill('a-long-password-1');
    await form.getByRole('button', { name: language === 'ar' ? 'حفظ كلمة المرور' : 'Save password' }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ password: 'a-long-password-1' });
    await expect(page.getByTestId('settings-password-set-done')).toContainText('dark.admin@example.test');
    // The refreshed session now reports a password: status flips, button gone.
    await expect(page.getByTestId('settings-password-status')).toHaveText(language === 'ar' ? 'مُعيّنة لهذا الحساب' : 'Set for this account');
    await expect(page.getByTestId('settings-set-password')).toHaveCount(0);
  });
}

test('a server refusal is shown in the form', async ({ page }) => {
  await session(page, { provider: 'google', passwordSet: false });
  await page.route('**/api/auth/set-password', async (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'This account already has a password.' }) }));
  await openSettings(page);
  await expect(page.getByTestId('settings-password-status')).toHaveText('Managed by Google');
  await page.getByTestId('settings-set-password').click();
  await page.getByTestId('set-password').fill('a-long-password-1');
  await page.getByTestId('set-password-confirm').fill('a-long-password-1');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByTestId('settings-set-password-form').getByRole('alert')).toHaveText('This account already has a password.');
});

test('no "Set a password" for an email/password account, a provider account that already set one, or a signed-out visitor', async ({ page }) => {
  await session(page, { provider: 'password', passwordSet: true });
  await openSettings(page);
  await expect(page.getByTestId('settings-password-status')).toHaveText('Set for this account');
  await expect(page.getByTestId('settings-set-password')).toHaveCount(0);

  await session(page, { provider: 'replit', passwordSet: true });
  await openSettings(page);
  await expect(page.getByTestId('settings-password-status')).toHaveText('Set for this account');
  await expect(page.getByTestId('settings-set-password')).toHaveCount(0);

  await page.route('**/api/me', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null, role: 'consumer', creator: null, isAdmin: false, language: null, notifyPush: true, notifyEmail: true, supportEmail: null, authProvider: null, passwordSet: false, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: {} }) }));
  await openSettings(page);
  await expect(page.getByTestId('settings-password-status')).toHaveText('Not available');
  await expect(page.getByTestId('settings-set-password')).toHaveCount(0);
  // The sign-in screen itself has no such control.
  await page.getByTestId('settings-sign-in').click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('Set a password')).toHaveCount(0);
});
