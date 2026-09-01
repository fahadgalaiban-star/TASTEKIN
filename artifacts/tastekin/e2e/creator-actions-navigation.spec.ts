import { expect, test, type Page } from '@playwright/test';

test.setTimeout(30_000);

// Regression coverage for a live-site bug report: viewing another creator's
// profile must offer a clear Report/Block/Mute actions menu that is
// distinct from the signed-in member's own account-settings icon, and
// pressing Back after opening Settings from that profile must return to
// the same creator's profile — not to the signed-in member's own profile
// or account tab. See goBack()/settingsReturnScreenRef in App.tsx.

const BOB = { username: 'bob_creator', displayName: 'Bob Creator' };

async function mockSession(page: Page, getLanguage: () => 'en' | 'ar', setLanguage: (next: 'en' | 'ar') => void) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      body: JSON.stringify({
        user: { id: 'alice', email: 'alice@tastekin.test' },
        role: 'consumer',
        creator: null,
        isAdmin: false,
        language: getLanguage(),
        notifyPush: true,
        notifyEmail: true,
        subscribed: false,
        supportEmail: null,
        needsOnboarding: false,
        onboardingStep: 'done',
        googleAuthConfigured: false,
      }),
    });
  });
  await page.route('**/api/settings', async (route) => {
    const body = route.request().postDataJSON() as { language?: 'en' | 'ar' };
    if (body.language === 'en' || body.language === 'ar') setLanguage(body.language);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ language: getLanguage(), notifyPush: true, notifyEmail: true }) });
  });
}

async function mockBobDiscovery(page: Page) {
  await page.route('**/api/explore**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        sort: 'best',
        creators: [{
          id: 'bob', username: BOB.username, displayName: BOB.displayName, avatar: '',
          categories: [], matchScore: null, matchReasons: [],
        }],
        edits: [], collections: [], places: [], products: [],
      }),
    });
  });
  await page.route(`**/api/creators/${BOB.username}/profile`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        displayName: BOB.displayName, username: BOB.username, bio: '', city: '', country: '', interests: [],
        avatar: '', avatarObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: false, revision: 1,
      }),
    });
  });
  await page.route(`**/api/creators/${BOB.username}/workspace`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ edits: [], collections: [] }) });
  });
  await page.route(`**/api/creators/${BOB.username}/featured-collections`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) });
  });
  await page.route(`**/api/relationships/follow/${BOB.username}`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ active: false }) });
  });
  await page.route(`**/api/mutes/status/${BOB.username}`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ muted: false }) });
  });
  await page.route('**/api/public-feed', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
}

async function openBobProfileFromExplore(page: Page) {
  await page.getByTestId('nav-explore').click();
  await page.locator('.approved-search input').fill('bob');
  await page.getByTestId(`creator-${BOB.username}`).click();
  await expect(page.getByRole('heading', { name: BOB.displayName })).toBeVisible();
}

/** Signs a mocked session in as Alice, mocks Bob's discovery data, and — for
 * 'ar' — switches the persisted account language before reloading, so the
 * app genuinely renders RTL rather than just an unauthoritative URL param. */
async function setup(page: Page, lang: 'en' | 'ar') {
  let language: 'en' | 'ar' = lang;
  await mockSession(page, () => language, (next) => { language = next; });
  await mockBobDiscovery(page);
  await page.goto('/');
  if (lang === 'ar') {
    await page.getByTestId('open-settings-topbar').click();
    await page.getByTestId('settings-language-ar').click();
    await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
    await page.goto('/');
    await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
  }
}

for (const lang of ['en', 'ar'] as const) {
  test.describe(`creator actions menu and Back navigation (${lang})`, () => {
    test(`another creator's profile shows a Report/Block/Mute actions menu distinct from the account-settings icon (${lang})`, async ({ page }) => {
      await setup(page, lang);
      await openBobProfileFromExplore(page);

      // The account-settings icon (topbar) must exist independently of the
      // creator's own actions menu — they are two separate affordances.
      await expect(page.getByTestId('open-settings-topbar')).toBeVisible();

      const moreOptions = page.locator('.report-trigger');
      await expect(moreOptions).toBeVisible();
      await moreOptions.click();

      const menu = page.locator('.report-menu');
      await expect(menu).toBeVisible();
      if (lang === 'ar') {
        await expect(menu).toContainText('الإبلاغ عن هذا الحساب');
        await expect(menu).toContainText('كتم هذا المستخدم');
        await expect(menu).toContainText('حظر هذا المستخدم');
      } else {
        await expect(menu).toContainText('Report this profile');
        await expect(menu).toContainText('Mute this user');
        await expect(menu).toContainText('Block this user');
      }
    });

    test(`Back after opening Settings from another creator's profile returns to that profile, not the signer's own (${lang})`, async ({ page }) => {
      await setup(page, lang);
      await openBobProfileFromExplore(page);
      await page.getByTestId('open-settings-topbar').click();
      await expect(page.getByRole('heading', { name: lang === 'ar' ? 'الإعدادات' : 'Settings' })).toBeVisible();

      await page.getByRole('button', { name: lang === 'ar' ? 'رجوع' : 'Back' }).click();
      await expect(page.getByRole('heading', { name: BOB.displayName })).toBeVisible();
      await expect(page.locator('.report-trigger')).toBeVisible();
    });

    test(`reporting, blocking, and muting another creator's profile all submit correctly (${lang})`, async ({ page }) => {
      test.setTimeout(45_000);
      let reportedBody: unknown = null;
      let blockedBody: unknown = null;
      let mutedBody: unknown = null;
      await setup(page, lang);
      await page.route('**/api/reports', async (route) => {
        reportedBody = route.request().postDataJSON();
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'report-1' }) });
      });
      await page.route('**/api/blocks', async (route) => {
        blockedBody = route.request().postDataJSON();
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ blocked: true }) });
      });
      await page.route('**/api/mutes', async (route) => {
        mutedBody = route.request().postDataJSON();
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ muted: true }) });
      });
      await openBobProfileFromExplore(page);

      // Report.
      await page.locator('.report-trigger').click();
      await page.getByText(lang === 'ar' ? 'الإبلاغ عن هذا الحساب' : 'Report this profile').click();
      await page.getByText(lang === 'ar' ? 'أخرى' : 'Other').click();
      await page.locator('textarea').fill('Automated e2e regression check');
      await page.getByRole('button', { name: lang === 'ar' ? 'إرسال البلاغ' : 'Submit report' }).click();
      await expect.poll(() => reportedBody).toMatchObject({ targetType: 'profile', targetId: BOB.username, reason: 'other' });
      await page.getByRole('button', { name: lang === 'ar' ? 'تم' : 'Done' }).click();

      // Re-open the menu for Mute.
      await page.locator('.report-trigger').click();
      await page.getByText(lang === 'ar' ? 'كتم هذا المستخدم' : 'Mute this user').click();
      await page.getByRole('button', { name: lang === 'ar' ? 'كتم' : 'Mute' }).click();
      await expect.poll(() => mutedBody).toMatchObject({ username: BOB.username });
      await page.getByRole('button', { name: lang === 'ar' ? 'تم' : 'Done' }).click();

      // Re-open the menu for Block.
      await page.locator('.report-trigger').click();
      await page.getByText(lang === 'ar' ? 'حظر هذا المستخدم' : 'Block this user').click();
      await page.getByRole('button', { name: lang === 'ar' ? 'حظر' : 'Block' }).click();
      await expect.poll(() => blockedBody).toMatchObject({ username: BOB.username });
    });
  });
}
