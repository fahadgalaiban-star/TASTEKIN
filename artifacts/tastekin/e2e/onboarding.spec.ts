import { expect, test } from '@playwright/test';

// New-user onboarding: appears right after sign-in for a genuinely new
// account, persists each step to the server, resumes at the correct step
// after a reload (never restarting from scratch), and renders correctly in
// both English/LTR and Arabic/RTL.
test('onboarding appears for a new user, saves each step, and resumes on reload', async ({ page }) => {
  let onboardingStep: 'basics' | 'photo' | 'city' | 'taste' | 'done' = 'basics';
  const profile = {
    displayName: '', username: 'member_123', bio: '', city: '', country: '',
    interests: [] as string[], avatar: '', avatarObjectPath: null as string | null,
    age: null, dateOfBirth: null, showAge: false, verified: false, revision: 1,
  };
  let taste = { categories: [] as string[], tags: [] as string[] };
  const ORDER = ['basics', 'photo', 'city', 'taste', 'done'] as const;

  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      body: JSON.stringify({
        user: { id: 'onboarding-e2e-user', email: 'onboarding-e2e@tastekin.test' },
        role: 'creator',
        creator: { id: 'creator_e2e', handle: profile.username, displayName: profile.displayName, verified: false, ownsWorkspace: true },
        isAdmin: false,
        language: 'en',
        notifyPush: true,
        notifyEmail: true,
        subscribed: false,
        supportEmail: null,
        needsOnboarding: onboardingStep !== 'done',
        onboardingStep,
      }),
    });
  });

  await page.route('**/api/creator-profile', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      Object.assign(profile, body);
      profile.revision += 1;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(profile) });
  });

  await page.route('**/api/creator-workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ edits: [], collections: [], revision: 1 }) });
  });
  await page.route('**/api/creator-featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) });
  });

  await page.route('**/api/taste-catalog', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        categories: [{ id: 'Fashion', label: 'Fashion & Outfits', labelAr: 'أزياء وإطلالات' }],
        tags: [
          { id: 'quiet-luxury', categoryId: 'Fashion', label: 'Quiet luxury', labelAr: 'فخامة هادئة' },
          { id: 'tailoring', categoryId: 'Fashion', label: 'Tailoring', labelAr: 'تفصيل' },
        ],
        minCategories: 1,
        minTags: 2,
      }),
    });
  });
  await page.route('**/api/taste-preferences', async (route) => {
    if (route.request().method() === 'PUT') {
      taste = route.request().postDataJSON() as { categories: string[]; tags: string[] };
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...taste, updatedAt: new Date().toISOString() }) });
  });

  await page.route('**/api/onboarding/advance', async (route) => {
    const index = ORDER.indexOf(onboardingStep);
    onboardingStep = ORDER[index + 1];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ step: onboardingStep, completed: onboardingStep === 'done' }) });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('onboarding-basics')).toBeVisible();
  await expect(page.locator('.approved-bottom')).toHaveCount(0);

  await page.getByPlaceholder('Your name').fill('Nora Member');
  await page.getByPlaceholder('yourname').fill('nora_member');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('onboarding-photo')).toBeVisible();
  expect(profile.displayName).toBe('Nora Member');
  expect(profile.username).toBe('nora_member');

  // Reload mid-flow: the resumed step must come from the server (still
  // 'photo' here), never resetting back to 'basics'.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('onboarding-photo')).toBeVisible();

  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByTestId('onboarding-city')).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByTestId('onboarding-taste')).toBeVisible();

  await page.locator('.onboarding-screen .age-toggle input[type="checkbox"]').click();
  await page.getByText('Quiet luxury').click();
  await page.getByText('Tailoring').click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByTestId('nav-home')).toBeVisible();
  expect(taste.categories).toContain('Fashion');
  expect(taste.tags).toEqual(expect.arrayContaining(['quiet-luxury', 'tailoring']));
});

test('onboarding renders correctly in Arabic/RTL', async ({ page }) => {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'onboarding-ar-user', email: 'onboarding-ar@tastekin.test' },
        role: 'creator',
        creator: { id: 'creator_ar', handle: 'member', displayName: '', verified: false, ownsWorkspace: true },
        isAdmin: false,
        language: 'ar',
        notifyPush: true,
        notifyEmail: true,
        subscribed: false,
        supportEmail: null,
        needsOnboarding: true,
        onboardingStep: 'basics',
      }),
    });
  });
  await page.route('**/api/creator-profile', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ displayName: '', username: 'member', bio: '', city: '', country: '', interests: [], avatar: '', avatarObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: false, revision: 1 }),
    });
  });
  await page.route('**/api/creator-workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ edits: [], collections: [], revision: 1 }) });
  });
  await page.route('**/api/creator-featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByTestId('onboarding-basics')).toBeVisible();
  await expect(page.getByText('مرحباً بك في تيستكن')).toBeVisible();
  await expect(page.getByText('الاسم الظاهر')).toBeVisible();
});
