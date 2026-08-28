import { expect, test } from '@playwright/test';

// The Settings language toggle must (a) persist to the server, not just
// localStorage, and (b) drive the app-wide LTR/RTL direction immediately
// and again after a fresh page load that re-reads the persisted value.
test('language toggle in Settings persists server-side and drives LTR/RTL app-wide', async ({ page }) => {
  let language: 'en' | 'ar' = 'en';

  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      body: JSON.stringify({
        user: { id: 'settings-e2e-user', email: 'settings-e2e@tastekin.test' },
        role: 'consumer',
        creator: null,
        isAdmin: false,
        language,
        notifyPush: true,
        notifyEmail: true,
        subscribed: false,
        supportEmail: null,
      }),
    });
  });

  await page.route('**/api/settings', async (route) => {
    const body = route.request().postDataJSON() as { language?: 'en' | 'ar' };
    if (body.language === 'en' || body.language === 'ar') language = body.language;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ language, notifyPush: true, notifyEmail: true }) });
  });

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByTestId('open-settings-topbar').click();
  await expect(page.getByTestId('settings-language-en')).toBeVisible();

  await page.getByTestId('settings-language-ar').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByTestId('settings-language-ar')).toHaveClass(/selected/);

  // Reload: the server (not localStorage) is the source of truth for a
  // signed-in account, so the persisted 'ar' choice must survive a refresh.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-language-en').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
