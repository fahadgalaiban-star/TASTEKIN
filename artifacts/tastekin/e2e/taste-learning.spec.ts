import { expect, test, type Page } from '@playwright/test';

// Taste learning (flags taste_ranking + taste_learning) — the web app's side:
//  - the Edit detail "More options" menu offers "Not interested" (EN/AR) only
//    when both flags are on, the member is signed in and does not own the Edit;
//    tapping it POSTs /api/edits/:id/not-interested, goes back and the card is
//    gone from Home;
//  - a Home card that stayed on screen for 2+ seconds reports one edit_dwell
//    analytics event (editId, whole seconds, surface "home") when it leaves;
//  - with taste_learning off nothing is sent and the menu item does not exist.
// The ranking effect itself is the server's job: unit tests + verify:taste-learning.

type Lang = 'en' | 'ar';

async function session(page: Page, { language = 'en', learning = true, signedIn = true }: { language?: Lang; learning?: boolean; signedIn?: boolean } = {}) {
  await page.addInitScript(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('tastekin:')) localStorage.removeItem(key); });
  await page.route('**/api/me', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      user: signedIn ? { id: 'member', email: 'member@tastekin.test' } : null, role: 'consumer', creator: null,
      isAdmin: false, language, notifyPush: true, notifyEmail: true, supportEmail: null,
      needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false,
      featureFlags: { taste_ranking: true, taste_learning: learning },
    }),
  }));
  await page.route('**/api/edits/*/engagement', async (route) => route.fulfill({ json: { editId: 'x', likeCount: 0, commentCount: 0, liked: false, saved: false } }));
  await page.route('**/api/edits/*/comments', async (route) => route.fulfill({ json: [] }));
}

const feedItem = (id: string) => ({
  creatorUsername: 'fheed', creatorName: 'Fheed Alaiban', creatorVerified: true, creatorAvatar: '/tastekin-media/fheed-profile.webp', following: false,
  matchScore: 40, sharedTastes: [],
  edit: { id, category: 'Restaurants', title: `Edit ${id}`, titleAr: `تعديل ${id}`, caption: `Caption for ${id}`, captionAr: `تعليق ${id}`, image: '/tastekin-media/quiet-tailoring.webp', location: '', locationAr: '', altText: '', access: 'public', status: 'published', collectionIds: [] },
});

async function homeFeed(page: Page, ids: string[]) {
  await page.route('**/api/public-feed', async (route) => route.fulfill({ json: { ranking: 'taste', learning: true, items: ids.map(feedItem) } }));
}

for (const language of ['en', 'ar'] as const) {
  test(`Not interested: in the Edit menu, posts the dismissal and removes the card from Home (${language})`, async ({ page }) => {
    await session(page, { language });
    await homeFeed(page, ['first', 'second']);
    const dismissed: string[] = [];
    await page.route('**/api/edits/*/not-interested', async (route) => {
      expect(route.request().method()).toBe('POST');
      dismissed.push(route.request().url());
      await route.fulfill({ json: { ok: true, editId: 'first' } });
    });
    await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('edit-card-first')).toBeVisible();
    await page.getByTestId('edit-title-first').click();
    await page.getByRole('button', { name: language === 'ar' ? 'مزيد من الخيارات' : 'More options' }).click();
    const item = page.getByTestId('edit-not-interested');
    await expect(item).toHaveText(language === 'ar' ? /لا يهمني/ : /Not interested/);
    await item.click();
    await expect.poll(() => dismissed.length).toBe(1);
    expect(dismissed[0]).toMatch(/\/api\/edits\/first\/not-interested$/);
    // Back on Home without the dismissed Edit; the other one stays.
    await expect(page.getByTestId('edit-card-second')).toBeVisible();
    await expect(page.getByTestId('edit-card-first')).toHaveCount(0);
  });
}

test('Not interested is absent when taste_learning is off', async ({ page }) => {
  await session(page, { learning: false });
  await homeFeed(page, ['first']);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('edit-title-first').click();
  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByRole('button', { name: 'Report this Edit' })).toBeVisible();
  await expect(page.getByTestId('edit-not-interested')).toHaveCount(0);
});

test('a signed-out visitor never sees Not interested even with the flags on: More options asks them to sign in', async ({ page }) => {
  await session(page, { signedIn: false });
  await homeFeed(page, ['first']);
  const dismissed: string[] = [];
  await page.route('**/api/edits/*/not-interested', async (route) => { dismissed.push(route.request().url()); await route.fulfill({ status: 401, json: { error: 'Sign in' } }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('edit-title-first').click();
  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByTestId('edit-not-interested')).toHaveCount(0);
  expect(dismissed).toEqual([]);
});

async function captureDwell(page: Page) {
  const events: Array<{ name: string; metadata: Record<string, unknown> }> = [];
  await page.route('**/api/analytics/events', async (route) => {
    events.push(route.request().postDataJSON() as { name: string; metadata: Record<string, unknown> });
    await route.fulfill({ status: 202, json: { recorded: true } });
  });
  return events;
}

test('a Home card on screen for 2+ seconds reports one edit_dwell event with editId, seconds and surface when it leaves', async ({ page }) => {
  await session(page);
  await homeFeed(page, ['first']);
  const events = await captureDwell(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('edit-card-first')).toBeVisible();
  await page.waitForTimeout(2_600);
  // Leaving Home unmounts the card, which flushes the dwell once.
  await page.getByTestId('nav-explore').click();
  await expect.poll(() => events.filter((event) => event.name === 'edit_dwell').length).toBe(1);
  const dwell = events.find((event) => event.name === 'edit_dwell')!;
  expect(dwell.metadata.editId).toBe('first');
  expect(dwell.metadata.surface).toBe('home');
  expect(Number.isInteger(dwell.metadata.seconds)).toBe(true);
  expect(dwell.metadata.seconds as number).toBeGreaterThanOrEqual(2);
  expect(dwell.metadata.seconds as number).toBeLessThanOrEqual(60);
  expect(Object.keys(dwell.metadata).sort()).toEqual(['editId', 'seconds', 'surface']);
  // Coming back and leaving again quickly does not report a second time for a short stay.
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('edit-card-first')).toBeVisible();
  await page.getByTestId('nav-explore').click();
  await page.waitForTimeout(400);
  expect(events.filter((event) => event.name === 'edit_dwell').length).toBe(1);
});

test('no edit_dwell is sent when taste_learning is off', async ({ page }) => {
  await session(page, { learning: false });
  await homeFeed(page, ['first']);
  const events = await captureDwell(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('edit-card-first')).toBeVisible();
  await page.waitForTimeout(2_600);
  await page.getByTestId('nav-explore').click();
  await page.waitForTimeout(400);
  expect(events.filter((event) => event.name === 'edit_dwell')).toEqual([]);
});
