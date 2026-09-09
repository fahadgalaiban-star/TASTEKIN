import { expect, test, type Page } from '@playwright/test';

const VISITOR = {
  username: 'noura.studio',
  displayName: 'Noura Studio',
};
const NOURA_AVATAR = '/tastekin-media/quiet-tailoring.webp';
const LAYLA_AVATAR = '/tastekin-media/private-hotel-preview.webp';

const edit = (id: string, access: 'public' | 'locked') => ({
  id,
  category: 'Fashion',
  title: access === 'public' ? 'A considered uniform' : 'Private hotel weekend',
  titleAr: access === 'public' ? 'إطلالة مدروسة' : 'عطلة فندقية خاصة',
  caption: access === 'public' ? 'A quiet uniform for an everyday city.' : 'The stay, the packing list, and where I ate.',
  captionAr: access === 'public' ? 'إطلالة هادئة ليوم عادي في المدينة.' : 'الإقامة، قائمة الحقائب، والأماكن التي تناولت فيها الطعام.',
  image: access === 'public' ? '/tastekin-media/quiet-tailoring.webp' : '/tastekin-media/private-hotel-preview.webp',
  location: 'Kuwait City, Kuwait',
  locationAr: 'مدينة الكويت، الكويت',
  altText: access === 'public' ? 'A considered outfit.' : 'Private hotel preview.',
  access,
  status: 'published',
  collectionIds: [],
});

async function session(page: Page, authenticated: boolean, language: 'en' | 'ar' = 'en', owner = false, myCircle = true) {
  await page.route('**/api/circle/members', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        { creatorId: VISITOR.username, username: VISITOR.username, displayName: VISITOR.displayName, avatar: NOURA_AVATAR, verified: true, addedAt: '2026-09-09T08:00:00.000Z' },
        { creatorId: 'layla', username: 'layla', displayName: 'Layla', avatar: LAYLA_AVATAR, verified: true, addedAt: '2026-09-08T08:00:00.000Z' },
      ]),
    });
  });
  await page.route('**/api/me', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(authenticated ? {
      user: { id: 'member', email: 'member@tastekin.test' }, role: owner ? 'creator' : 'consumer',
      creator: owner ? { id: 'owner', handle: 'owner', displayName: 'Owner', verified: true, ownsWorkspace: true } : null,
      isAdmin: false, language, notifyPush: true, notifyEmail: true, subscribed: false,
      supportEmail: null, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false,
      featureFlags: { my_circle: myCircle },
    } : {
      user: null, role: 'consumer', creator: null, isAdmin: false, language: null,
      notifyPush: true, notifyEmail: true, subscribed: false, supportEmail: null,
      needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: { my_circle: myCircle },
    }),
  }));
}

async function discovery(page: Page, verified = true) {
  await page.route('**/api/explore**', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true, sort: 'best',
      creators: [{ id: VISITOR.username, username: VISITOR.username, displayName: VISITOR.displayName, avatar: NOURA_AVATAR, categories: [], matchScore: null, matchReasons: [] }],
      edits: [], collections: [], places: [], products: [],
    }),
  }));
  await page.route(`**/api/creators/${VISITOR.username}/profile`, async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      displayName: VISITOR.displayName, username: VISITOR.username, bio: '', city: 'Kuwait City', country: 'Kuwait',
      interests: [], avatar: NOURA_AVATAR, avatarObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified, revision: 1,
    }),
  }));
  await page.route(`**/api/creators/${VISITOR.username}/workspace`, async (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ edits: [], collections: [] }),
  }));
  await page.route(`**/api/creators/${VISITOR.username}/featured-collections`, async (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }),
  }));
  await page.route(`**/api/relationships/follow/${VISITOR.username}`, async (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ active: false }),
  }));
  await page.route('**/api/public-feed', async (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ items: [] }),
  }));
  await page.route('**/api/circle/members/*', async (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ creatorId: VISITOR.username, active: true }),
  }));
}

async function openVisitor(page: Page) {
  await page.getByTestId('nav-explore').click();
  await page.getByTestId(`creator-${VISITOR.username}`).click();
  await expect(page.getByRole('heading', { name: VISITOR.displayName })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('tastekin:')) localStorage.removeItem(key);
  });
});

test('authenticated Home exposes My Circle, renders protected feed safely, and stays within mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await session(page, true);
  await discovery(page);
  let refreshed = false;
  await page.route('**/api/circle/feed', async (route) => {
    const items = [
      { creatorUsername: VISITOR.username, creatorName: VISITOR.displayName, creatorVerified: true, edit: edit('circle-public', 'public') },
      { creatorUsername: VISITOR.username, creatorName: VISITOR.displayName, creatorVerified: true, edit: { ...edit('circle-locked', 'locked'), sourceImage: '/objects/private-hotel-source', previewImage: '/tastekin-media/private-hotel-preview.webp' } },
      { creatorUsername: 'layla', creatorName: 'Layla', creatorVerified: true, edit: { ...edit('circle-public', 'public'), caption: 'Layla owns this duplicate edit ID.' } },
    ];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(refreshed ? [items[2]] : items) });
  });
  await page.goto('/');
  await expect(page.getByTestId('primary-navigation').getByRole('button')).toHaveCount(5);
  await expect(page.getByTestId('home-tab-my-circle')).toBeVisible();
  await page.getByTestId('nav-you').click();
  await expect(page.getByTestId('open-my-circle')).toBeVisible();
  await page.getByTestId('open-my-circle').click();
  await expect(page.getByRole('heading', { name: 'My Circle' })).toBeVisible();
  await expect(page.getByText('The creators you keep close')).toBeVisible();
  await expect(page.getByTestId(`circle-member-${VISITOR.username}`).locator('img')).toHaveAttribute('src', NOURA_AVATAR);
  await expect(page.getByTestId('circle-member-layla').locator('img')).toHaveAttribute('src', LAYLA_AVATAR);
  await expect(page.getByTestId('edit-card-circle-public').first().locator('.feed-creator-avatar img')).toHaveAttribute('src', NOURA_AVATAR);
  await expect(page.getByTestId('edit-title-circle-public').first()).toBeVisible();
  await expect(page.getByTestId('edit-title-circle-locked')).toBeVisible();
  await expect(page.getByText('/objects/private-hotel-source')).toHaveCount(0);
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
  await page.getByLabel('Filter creators').selectOption('layla');
  await expect(page.getByText('Layla owns this duplicate edit ID.')).toBeVisible();
  await expect(page.getByTestId('edit-title-circle-locked')).toHaveCount(0);
  await page.getByLabel('Filter creators').selectOption('');
  await expect(page.getByTestId('edit-title-circle-locked')).toBeVisible();
  await page.getByTestId(`circle-member-${VISITOR.username}`).click();
  await expect(page.getByRole('heading', { name: VISITOR.displayName })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('home-tab-my-circle')).toHaveClass(/active/);
  refreshed = true;
  await page.getByTestId('home-tab-following').click();
  await page.getByTestId('home-tab-my-circle').click();
  await expect(page.getByTestId('edit-title-circle-public')).toHaveCount(1);
  await page.getByTestId('edit-title-circle-public').click();
  await expect(page.getByRole('heading', { name: 'Layla owns this duplicate edit ID.' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('home-tab-my-circle')).toHaveClass(/active/);
});

test('creator identity, media, and Save keep separate navigation across every Home feed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await session(page, true);
  await discovery(page);
  const publicItem = {
    creatorUsername: VISITOR.username,
    creatorName: VISITOR.displayName,
    creatorVerified: true,
    creatorAvatar: NOURA_AVATAR,
    following: true,
    edit: edit('home-navigation', 'public'),
  };
  await page.route('**/api/public-feed', async (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ items: [publicItem] }),
  }));
  await page.route('**/api/circle/feed', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ creatorUsername: VISITOR.username, creatorName: VISITOR.displayName, creatorVerified: true, edit: edit('circle-navigation', 'public') }]),
  }));
  await page.route('**/api/saved-edits/**', async (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto('/');

  for (const tab of ['for-you', 'following'] as const) {
    if (tab === 'following') await page.getByTestId('home-tab-following').click();
    const card = page.getByTestId('edit-card-home-navigation');
    await card.getByTestId(`creator-link-${VISITOR.username}`).click();
    await expect(page.getByRole('heading', { name: VISITOR.displayName })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId(`home-tab-${tab}`)).toHaveClass(/active/);
  }

  await page.getByTestId('home-tab-my-circle').click();
  const circleCard = page.getByTestId('edit-card-circle-navigation');
  await circleCard.getByTestId(`creator-link-${VISITOR.username}`).click();
  await expect(page.getByRole('heading', { name: VISITOR.displayName })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('home-tab-my-circle')).toHaveClass(/active/);

  await circleCard.getByTestId('save-circle-navigation').click();
  await expect(circleCard).toBeVisible();
  await circleCard.locator('.approved-art').click();
  await expect(page.getByRole('heading', { name: 'A quiet uniform for an everyday city.' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('home-tab-my-circle')).toHaveClass(/active/);
  await expect(page.getByTestId('edit-card-circle-navigation')).toBeVisible();
});

test('My Circle OFF hides Home, You, and verified profile actions without Circle requests', async ({ page }) => {
  await session(page, true, 'en', false, false);
  await discovery(page, true);
  let circleRequests = 0;
  await page.route('**/api/circle/**', async (route) => {
    circleRequests += 1;
    await route.abort();
  });
  await page.goto('/');
  await expect(page.getByTestId('home-tab-my-circle')).toHaveCount(0);
  await page.getByTestId('nav-you').click();
  await expect(page.getByTestId('open-my-circle')).toHaveCount(0);
  await page.getByTestId('nav-home').click();
  await openVisitor(page);
  await expect(page.getByTestId('profile-circle-action')).toHaveCount(0);
  expect(circleRequests).toBe(0);
});

test('empty Circle is localized and failed Circle feed can retry', async ({ page }) => {
  test.setTimeout(30_000);
  await session(page, true, 'ar');
  let attempts = 0;
  await page.route('**/api/circle/feed', async (route) => {
    attempts += 1;
    if (attempts <= 4) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Unavailable' }) });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.goto('/');
  await page.getByTestId('home-tab-my-circle').click();
  await expect(page.getByRole('alert')).toContainText('تعذر تحميل دائرتك', { timeout: 15_000 });
  await page.getByRole('button', { name: 'حاول مجددًا' }).click();
  await expect(page.getByText('لا توجد تعديلات في دائرتك بعد.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'اذهب إلى اكتشف' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'دائرتي' })).toBeVisible();
  await expect(page.getByText('المبدعون الأقرب إليك')).toBeVisible();
  await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
  expect(attempts).toBeGreaterThanOrEqual(2);
});

test('verified visitor Circle membership sends username actions and preserves Follow state', async ({ page }) => {
  await session(page, true);
  await discovery(page, true);
  let active = false;
  const methods: string[] = [];
  const targets: string[] = [];
  await page.route(`**/api/circle/members/${VISITOR.username}`, async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ creatorId: VISITOR.username, active }) });
    }
    methods.push(route.request().method());
    targets.push(new URL(route.request().url()).pathname.split('/').at(-1) || '');
    if (route.request().method() === 'PUT') active = true;
    if (route.request().method() === 'DELETE') active = false;
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ creatorId: VISITOR.username, active }) });
  });
  await page.goto('/');
  await openVisitor(page);
  await expect(page.getByRole('button', { name: 'Follow' })).toBeVisible();
  await page.getByTestId('profile-circle-action').click();
  await expect(page.getByRole('button', { name: 'In My Circle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
  await page.getByTestId('profile-circle-action').click();
  await expect(page.getByRole('button', { name: 'Add to My Circle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
  expect(methods).toContain('PUT');
  expect(methods).toContain('DELETE');
  expect(targets).toEqual([VISITOR.username, VISITOR.username]);
});

test('unverified, owner, and owner visitor-preview profiles have no Circle action', async ({ page }) => {
  await session(page, true, 'en', true);
  await discovery(page, false);
  await page.route('**/api/creator-profile', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      displayName: 'Owner', username: 'owner', bio: '', city: '', country: '', interests: [],
      avatar: '', avatarObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1,
    }),
  }));
  await page.route('**/api/creator-workspace', async (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ creatorId: 'owner', revision: 1, edits: [], collections: [] }),
  }));
  await page.route('**/api/creator-featured-collections', async (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }),
  }));
  await page.goto('/');
  await openVisitor(page);
  await expect(page.getByTestId('profile-circle-action')).toHaveCount(0);
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByTestId('profile-circle-action')).toHaveCount(0);
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByTestId('profile-view-public').click();
  await expect(page.getByTestId('profile-circle-action')).toHaveCount(0);
});

test('signed-out Home and You hide My Circle; signed-out verified profile action opens sign-in', async ({ page }) => {
  await session(page, false);
  await discovery(page, true);
  await page.goto('/');
  await expect(page.getByTestId('home-tab-my-circle')).toHaveCount(0);
  await page.getByTestId('nav-you').click();
  await expect(page.getByText('My Circle')).toHaveCount(0);
  await openVisitor(page);
  await page.getByTestId('profile-circle-action').click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});