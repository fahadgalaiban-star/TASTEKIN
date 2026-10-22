import { expect, test, type Page } from '@playwright/test';

// Terms of Use / Privacy Policy consent at signup: the account cannot be
// created until the box is ticked, the acceptance travels with the signup
// request, and the two document links open the legal pages.

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

async function openSignup(page: Page, language: 'en' | 'ar' = 'en') {
  await page.goto(language === 'ar' ? '/?lang=ar' : '/');
  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-sign-in').click();
  await expect(page.getByRole('heading', { name: language === 'ar' ? 'تسجيل الدخول' : 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: language === 'ar' ? 'ليس لديك حساب؟ أنشئ حساباً' : "Don't have an account? Sign up" }).click();
  await expect(page.getByRole('heading', { name: language === 'ar' ? 'أنشئ حسابك' : 'Create your account' })).toBeVisible();
}

for (const language of ['en', 'ar'] as const) {
  test(`signup requires Terms consent and sends the acceptance with the request (${language})`, async ({ page }) => {
    await signedOut(page, language);
    const signupBodies: Record<string, unknown>[] = [];
    await page.route('**/api/auth/signup', async (route) => {
      signupBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ user: { id: 'new', email: 'new@tastekin.test' } }) });
    });
    await openSignup(page, language);

    await expect(page.getByTestId('signup-consent')).toContainText(language === 'ar' ? 'أوافق على شروط الاستخدام وسياسة الخصوصية.' : 'I agree to the Terms of Use and the Privacy Policy.');
    await expect(page.getByTestId('signup-terms')).not.toBeChecked();
    await page.getByLabel(language === 'ar' ? 'البريد الإلكتروني' : 'Email').fill('new@tastekin.test');
    await page.getByLabel(language === 'ar' ? 'كلمة المرور' : 'Password', { exact: true }).fill('longenoughpassword');

    // Unticked: refused on the client, nothing is sent.
    await page.getByRole('button', { name: language === 'ar' ? 'إنشاء حساب' : 'Create account' }).click();
    await expect(page.getByRole('alert')).toHaveText(language === 'ar' ? 'يرجى الموافقة على شروط الاستخدام وسياسة الخصوصية لإنشاء حسابك.' : 'Please accept the Terms of Use and Privacy Policy to create your account.');
    expect(signupBodies).toHaveLength(0);

    // Ticked: the acceptance and the Terms version travel with the request.
    await page.getByTestId('signup-terms').check();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: language === 'ar' ? 'إنشاء حساب' : 'Create account' }).click();
    await expect.poll(() => signupBodies.length).toBe(1);
    expect(signupBodies[0]).toMatchObject({ email: 'new@tastekin.test', password: 'longenoughpassword', termsAccepted: true });
    expect(signupBodies[0].termsVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
}

test('the consent links open the Terms and the Privacy Policy in a sheet, keeping the form and the unticked box', async ({ page }) => {
  await signedOut(page);
  await openSignup(page);
  await page.getByLabel('Email').fill('new@tastekin.test');
  await page.getByTestId('signup-terms-link').click();
  const sheet = page.getByTestId('signup-legal-sheet');
  await expect(sheet.getByRole('heading', { name: 'Terms of Use' })).toBeVisible();
  await expect(sheet.getByTestId('legal-terms')).toContainText(/Effective \d{4}-\d{2}-\d{2}/);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue('new@tastekin.test');
  await expect(page.getByTestId('signup-terms')).not.toBeChecked();
  await page.getByTestId('signup-privacy-link').click();
  await expect(sheet.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await expect(sheet.getByTestId('legal-privacy')).toBeVisible();
  await expect(page.getByTestId('signup-terms')).not.toBeChecked();
});

test('a server-side Terms refusal is shown to the user', async ({ page }) => {
  await signedOut(page);
  await page.route('**/api/auth/signup', async (route) => route.fulfill({
    status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'You must accept the Terms of Use and Privacy Policy to create an account.' }),
  }));
  await openSignup(page);
  await page.getByLabel('Email').fill('new@tastekin.test');
  await page.getByLabel('Password', { exact: true }).fill('longenoughpassword');
  await page.getByTestId('signup-terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toHaveText('You must accept the Terms of Use and Privacy Policy to create an account.');
});
