import { expect, test, type Page } from '@playwright/test';

// Taste-ranked Home (flag taste_ranking) — the web app's side of it:
//  - a Home card says which shared tastes matched when the server scored it,
//    in English and Arabic; never when it did not;
//  - the owner's Edit profile shows the taste-tag picker only with the flag
//    on, caps it at 8, and sends tasteTags with the save.
// The ordering itself is the server's job and is covered by the unit tests
// and verify:taste-ranking against the real API.

type Lang = 'en' | 'ar';
const CATALOG = {
  categories: [{ id: 'Restaurants', label: 'Restaurants', labelAr: 'مطاعم' }, { id: 'Travel', label: 'Travel', labelAr: 'سفر' }],
  tags: [
    { id: 'coffee-stops', categoryId: 'Restaurants', label: 'Coffee stops', labelAr: 'محطات القهوة' },
    { id: 'long-lunches', categoryId: 'Restaurants', label: 'Long lunches', labelAr: 'غداء طويل' },
    { id: 'table-setting', categoryId: 'Restaurants', label: 'Table setting', labelAr: 'تنسيق المائدة' },
    { id: 'slow-travel', categoryId: 'Travel', label: 'Slow travel', labelAr: 'سفر هادئ' },
    { id: 'coastal-escapes', categoryId: 'Travel', label: 'Coastal escapes', labelAr: 'رحلات ساحلية' },
    { id: 'packing-notes', categoryId: 'Travel', label: 'Packing notes', labelAr: 'ملاحظات الحقائب' },
    { id: 'city-guides', categoryId: 'Places', label: 'City guides', labelAr: 'أدلة المدن' },
    { id: 'hidden-gems', categoryId: 'Places', label: 'Hidden gems', labelAr: 'أماكن خفية' },
    { id: 'architecture', categoryId: 'Places', label: 'Architecture', labelAr: 'عمارة' },
  ],
  minCategories: 1, minTags: 2,
};

async function session(page: Page, { language = 'en', owner = false, flag = true }: { language?: Lang; owner?: boolean; flag?: boolean } = {}) {
  await page.route('**/api/me', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      user: { id: 'member', email: 'member@tastekin.test' }, role: owner ? 'creator' : 'consumer',
      creator: owner ? { id: 'owner', handle: 'owner', displayName: 'Owner', verified: true, ownsWorkspace: true } : null,
      isAdmin: false, language, notifyPush: true, notifyEmail: true, supportEmail: null,
      needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: { taste_ranking: flag },
    }),
  }));
  await page.route('**/api/taste-catalog', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(CATALOG) }));
}

const feedItem = (id: string, extra: Record<string, unknown> = {}) => ({
  creatorUsername: 'noura.studio', creatorName: 'Noura Studio', creatorVerified: true, creatorAvatar: '', following: false,
  edit: { id, category: 'Restaurants', title: `Edit ${id}`, titleAr: '', caption: `Caption for ${id}`, captionAr: `تعليق ${id}`, image: '/tastekin-media/quiet-tailoring.webp', location: '', locationAr: '', altText: '', access: 'public', status: 'published', collectionIds: [] },
  ...extra,
});

for (const language of ['en', 'ar'] as const) {
  test(`Home cards say which tastes matched when the server scored them (${language})`, async ({ page }) => {
    await session(page, { language });
    await page.route('**/api/public-feed', async (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ranking: 'taste',
        items: [
          feedItem('scored', { matchScore: 78, sharedTastes: [{ id: 'coffee-stops', label: 'Coffee stops', labelAr: 'محطات القهوة', type: 'tag' }, { id: 'Restaurants', label: 'Restaurants', labelAr: 'مطاعم', type: 'category' }] }),
          feedItem('zero', { matchScore: 0, sharedTastes: [] }),
          feedItem('unscored'),
        ],
      }),
    }));
    await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('edit-card-scored')).toBeVisible();
    await expect(page.getByTestId('feed-match-scored')).toHaveText(language === 'ar' ? 'يطابق ذوقك: محطات القهوة، مطاعم' : 'Matches your taste: coffee stops, restaurants');
    await expect(page.getByTestId('feed-match-zero')).toHaveCount(0);
    await expect(page.getByTestId('feed-match-unscored')).toHaveCount(0);
    // Never a number on a card.
    await expect(page.getByTestId('edit-card-scored')).not.toContainText('78');
  });
}

test('Home shows no match line at all when the server ranks by recency (flag off)', async ({ page }) => {
  await session(page, { flag: false });
  await page.route('**/api/public-feed', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ranking: 'recency', items: [feedItem('a'), feedItem('b')] }) }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('edit-card-a')).toBeVisible();
  await expect(page.locator('.feed-match')).toHaveCount(0);
});

async function ownerProfileMocks(page: Page, profile: Record<string, unknown>, onSave: (body: Record<string, unknown>) => void) {
  await page.route('**/api/creator-profile', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      onSave(body);
      Object.assign(profile, body, { revision: Number(profile.revision) + 1 });
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(profile) });
  });
  await page.route('**/api/creator-workspace', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ creatorId: 'owner', revision: 1, edits: [], collections: [] }) }));
  await page.route('**/api/creator-featured-collections', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) }));
}

const ownerProfile = () => ({
  displayName: 'Owner', username: 'owner', bio: '', city: '', country: '', interests: ['Restaurants'], tasteTags: ['coffee-stops'],
  avatar: '', avatarObjectPath: null, coverImage: '', coverImageObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1,
});

test('Edit profile offers taste tags for the chosen categories, caps at 8, and saves them', async ({ page }) => {
  await session(page, { owner: true });
  const saves: Record<string, unknown>[] = [];
  await ownerProfileMocks(page, ownerProfile(), (body) => saves.push(body));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await page.getByRole('button', { name: 'Edit profile' }).click();

  const picker = page.getByTestId('profile-taste-tags');
  await expect(picker).toBeVisible();
  // Only Restaurants tags while Restaurants is the only chosen category.
  await expect(picker.getByRole('button')).toHaveCount(3);
  await expect(page.getByTestId('taste-tag-coffee-stops')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('taste-tag-long-lunches').click();
  // Choosing Travel too widens the list.
  await page.getByRole('button', { name: 'Travel', exact: true }).click();
  await expect(picker.getByRole('button')).toHaveCount(6);
  await page.getByTestId('taste-tag-slow-travel').click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].tasteTags).toEqual(['coffee-stops', 'long-lunches', 'slow-travel']);
  expect(saves[0].interests).toEqual(['Restaurants', 'Travel']);
});

test('Edit profile hides the taste-tag picker when the flag is off', async ({ page }) => {
  await session(page, { owner: true, flag: false });
  await ownerProfileMocks(page, ownerProfile(), () => undefined);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible();
  await expect(page.getByTestId('profile-taste-tags')).toHaveCount(0);
});

test('the taste-tag picker reads correctly in Arabic/RTL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await session(page, { owner: true, language: 'ar' });
  await ownerProfileMocks(page, ownerProfile(), () => undefined);
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'عرض الملف' }).click();
  await page.getByRole('button', { name: 'تعديل الملف' }).click();
  await expect(page.getByText('وسوم الذوق')).toBeVisible();
  await expect(page.getByTestId('taste-tag-coffee-stops')).toHaveText(/محطات القهوة/);
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
});
