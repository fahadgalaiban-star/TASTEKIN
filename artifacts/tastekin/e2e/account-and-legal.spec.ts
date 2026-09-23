import { expect, test, type Page } from '@playwright/test';

// Store-readiness surfaces added with the free v1: the Privacy Policy and
// Terms of Use (in Settings and at public URLs), and the two-step account
// deletion flow (in Settings and at the public /delete-account URL Google
// Play links to). Verified in English and Arabic (RTL).

function mePayload(authenticated: boolean, language: 'en' | 'ar') {
  return authenticated
    ? { user: { id: 'member-1', email: 'member@tastekin.test' }, role: 'consumer', creator: null, isAdmin: false, language, notifyPush: true, notifyEmail: true, supportEmail: null, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: {} }
    : { user: null, role: 'consumer', creator: null, isAdmin: false, language: null, notifyPush: true, notifyEmail: true, supportEmail: null, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: {} };
}

async function session(page: Page, options: { authenticated: boolean; language?: 'en' | 'ar' }) {
  const state = { authenticated: options.authenticated };
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store, max-age=0' }, body: JSON.stringify(mePayload(state.authenticated, options.language ?? 'en')) });
  });
  return state;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('tastekin:')) localStorage.removeItem(key);
  });
});

test('Settings links to the Privacy Policy and Terms of Use, both carrying the effective date and the support address, in English', async ({ page }) => {
  await session(page, { authenticated: false });
  await page.goto('/');
  await page.getByTestId('open-settings-topbar').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // No trace of the removed paid tier anywhere on Settings.
  await expect(page.getByText(/Subscription|Stripe|billing|\$19\.99|\$1\.49/)).toHaveCount(0);

  await page.getByTestId('settings-privacy').click();
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByTestId('legal-privacy')).toContainText(/Effective \d{4}-\d{2}-\d{2}/);
  await expect(page.getByTestId('legal-privacy')).toContainText('support@tastekin.app');
  await expect(page.getByTestId('legal-privacy')).toContainText('we never sell your personal data');
  await expect(page.getByTestId('legal-privacy').getByText(/Delete account/)).toHaveCount(1);
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByTestId('settings-terms').click();
  await expect(page.getByRole('heading', { name: 'Terms of Use' })).toBeVisible();
  await expect(page.getByTestId('legal-terms')).toContainText('TASTEKIN does not charge for any feature');
  await expect(page.getByTestId('legal-terms')).toContainText('support@tastekin.app');
});

test('the legal pages render in Arabic with RTL direction', async ({ page }) => {
  await session(page, { authenticated: false, language: 'ar' });
  await page.goto('/?lang=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-privacy').click();
  await expect(page.getByRole('heading', { name: 'سياسة الخصوصية' })).toBeVisible();
  await expect(page.getByTestId('legal-privacy')).toContainText('سارية اعتباراً من');
  await expect(page.getByTestId('legal-privacy')).toContainText('support@tastekin.app');
  await page.getByRole('button', { name: 'رجوع' }).click();
  await page.getByTestId('settings-terms').click();
  await expect(page.getByRole('heading', { name: 'شروط الاستخدام' })).toBeVisible();
  await expect(page.getByTestId('legal-terms')).toContainText('استخدام TASTEKIN مجاني');
});

test('the Privacy Policy, Terms and account-deletion pages are reachable by plain URL without signing in', async ({ page }) => {
  await session(page, { authenticated: false });
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Terms of Use' })).toBeVisible();
  await page.goto('/delete-account');
  await expect(page.getByRole('heading', { name: 'Delete your account' })).toBeVisible();
  await expect(page.getByText('What is deleted')).toBeVisible();
  await expect(page.getByText('No support contact is required.')).toBeVisible();
  // A signed-out visitor is offered sign-in, never the deletion controls.
  await expect(page.getByTestId('delete-account-sign-in')).toBeVisible();
  await expect(page.getByTestId('delete-account-continue')).toHaveCount(0);
  await expect(page.getByTestId('delete-account-submit')).toHaveCount(0);
  await page.getByTestId('delete-account-sign-in').click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('Delete account is a deliberate two-step flow that only calls the server with the typed confirmation, then signs the member out', async ({ page }) => {
  const state = await session(page, { authenticated: true });
  const deleteCalls: unknown[] = [];
  await page.route('**/api/me/delete-account', async (route) => {
    deleteCalls.push(route.request().postDataJSON());
    state.authenticated = false;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ deleted: true, mediaCleanup: 'none' }) });
  });
  await page.goto('/');
  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-delete-account').click();
  await expect(page.getByRole('heading', { name: 'Delete your account' })).toBeVisible();
  await expect(page.getByText('This is permanent')).toBeVisible();
  await expect(page.getByText('Signed in as member@tastekin.test.')).toBeVisible();
  // Step 1: nothing but "Continue" is offered; no request is made.
  await expect(page.getByTestId('delete-account-submit')).toHaveCount(0);
  await page.getByTestId('delete-account-continue').click();
  // Step 2: the final button stays disabled until BOTH the acknowledgement
  // and the typed word are present.
  const submit = page.getByTestId('delete-account-submit');
  await expect(submit).toBeDisabled();
  await page.getByTestId('delete-account-acknowledge').check();
  await expect(submit).toBeDisabled();
  await page.getByTestId('delete-account-confirm-input').fill('delet');
  await expect(submit).toBeDisabled();
  await page.getByTestId('delete-account-confirm-input').fill('DELETE');
  await expect(submit).toBeEnabled();
  expect(deleteCalls).toEqual([]);
  await submit.click();
  await expect(page.getByTestId('delete-account-done')).toBeVisible();
  expect(deleteCalls).toEqual([{ confirm: 'DELETE' }]);
  await page.getByRole('button', { name: 'Done' }).click();
  // Signed out: the You tab offers sign-in again.
  await page.getByTestId('nav-you').click();
  await expect(page.getByTestId('you-sign-in')).toBeVisible();
});

test('a refusal from the server is shown without deleting anything, and the Arabic flow mirrors the English one', async ({ page }) => {
  await session(page, { authenticated: true, language: 'ar' });
  await page.route('**/api/me/delete-account', async (route) => {
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Administrator accounts cannot delete themselves.', code: 'admin_account' }) });
  });
  await page.goto('/?lang=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('open-settings-topbar').click();
  await expect(page.getByTestId('settings-privacy')).toContainText('سياسة الخصوصية');
  await page.getByTestId('settings-delete-account').click();
  await expect(page.getByRole('heading', { name: 'حذف حسابك' })).toBeVisible();
  await page.getByTestId('delete-account-continue').click();
  await page.getByTestId('delete-account-acknowledge').check();
  await page.getByTestId('delete-account-confirm-input').fill('DELETE');
  await page.getByTestId('delete-account-submit').click();
  await expect(page.getByRole('alert')).toContainText('لا يمكن لحسابات المسؤولين حذف نفسها');
  // Still on the confirmation step, still signed in.
  await expect(page.getByTestId('delete-account-submit')).toBeVisible();
  await expect(page.getByTestId('delete-account-done')).toHaveCount(0);
});
