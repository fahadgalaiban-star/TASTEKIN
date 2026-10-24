import { expect, test, type Page } from '@playwright/test';

// Owner-only follower count (flag owner_follower_count): a Followers tile on
// the Insights screen when the private payload carries `followers`; no tile
// otherwise; and never a follower number on the profile itself.

async function ownerSession(page: Page, language: 'en' | 'ar' = 'en') {
  await page.route('**/api/me', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      user: { id: 'owner', email: 'owner@tastekin.test' }, role: 'creator',
      creator: { id: 'owner', handle: 'owner', displayName: 'Owner', verified: true, ownsWorkspace: true },
      isAdmin: false, language, notifyPush: true, notifyEmail: true, supportEmail: null,
      needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: {},
    }),
  }));
  await page.route('**/api/creator-profile', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ displayName: 'Owner', username: 'owner', bio: '', city: '', country: '', interests: [], tasteTags: [], avatar: '', avatarObjectPath: null, coverImage: '', coverImageObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1 }),
  }));
  await page.route('**/api/creator-workspace', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ creatorId: 'owner', revision: 1, edits: [{ id: 'e1', category: 'Places', title: 'A long dinner with friends at the new agave bar downtown', titleAr: '', caption: '', captionAr: '', image: '/tastekin-media/quiet-tailoring.webp', location: '', locationAr: '', altText: '', access: 'public', status: 'published', collectionIds: [] }], collections: [] }) }));
  await page.route('**/api/creator-featured-collections', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) }));
}

async function openInsights(page: Page, language: 'en' | 'ar' = 'en') {
  await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: language === 'ar' ? 'عرض الملف' : 'View profile' }).click();
  await page.getByRole('button', { name: language === 'ar' ? 'الإحصاءات' : 'Insights' }).click();
}

const insights = (followers?: number | null) => ({ profileViews: 40, totalLikes: 7, totalSaves: 3, totalComments: 1, ...(followers === undefined ? {} : { followers }), edits: [{ editId: 'e1', likes: 7, saves: 3, comments: 1, views: 40 }] });

for (const language of ['en', 'ar'] as const) {
  test(`Insights shows the Followers tile when the private payload carries it (${language})`, async ({ page }) => {
    await ownerSession(page, language);
    await page.route('**/api/creator-insights', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(insights(12)) }));
    await openInsights(page, language);
    const tile = page.getByTestId('insights-followers');
    await expect(tile).toBeVisible();
    await expect(tile).toContainText('12');
    await expect(tile).toContainText(language === 'ar' ? 'المتابعون' : 'Followers');
  });
}

test('no Followers tile when the payload has none or null (flag off), and the profile never shows a follower count', async ({ page }) => {
  await ownerSession(page);
  let payload: Record<string, unknown> = insights();
  await page.route('**/api/creator-insights', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
  await openInsights(page);
  await expect(page.getByText('Profile views')).toBeVisible();
  await expect(page.getByTestId('insights-followers')).toHaveCount(0);

  payload = insights(null);
  await openInsights(page);
  await expect(page.getByText('Profile views')).toBeVisible();
  await expect(page.getByTestId('insights-followers')).toHaveCount(0);

  // The owner's own profile and a visitor's view of it carry no follower number.
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByRole('heading', { name: 'Owner' })).toBeVisible();
  await expect(page.getByText(/followers/i)).toHaveCount(0);
});
