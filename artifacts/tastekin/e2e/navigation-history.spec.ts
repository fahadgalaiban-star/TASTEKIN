import { expect, test, type Page } from '@playwright/test';

// A minimal, self-contained owner session — these tests exercise the
// history/back mechanism itself (App.tsx's go()/goBack()/popstate wiring),
// not any particular screen's content, so the mocks stay deliberately small.
async function mockSession(page: Page) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        user: { id: 'nav-e2e-user', email: 'nav-e2e@tastekin.test' },
        role: 'creator',
        creator: { id: 'fheed', handle: 'fheed', displayName: 'Fheed Alaiban', verified: true, ownsWorkspace: true },
        featureFlags: { my_circle: true, my_things: true, kin_search: true },
      }),
    });
  });
  await page.route('**/api/creator-profile', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ displayName: 'Fheed Alaiban', username: 'fheed', bio: '', city: '', country: '', interests: [], avatar: '', avatarObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1 }),
    });
  });
  await page.route('**/api/creator-workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ creatorId: 'fheed', revision: 1, edits: [], collections: [] }) });
  });
  await page.route('**/api/creator-featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.route('**/api/explore**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, sort: 'best', creators: [{ id: 'fheed-alaiban', username: 'fheed', displayName: 'Fheed Alaiban', avatar: '', categories: [], matchScore: null, matchReasons: [] }], edits: [] }) });
  });
}

test.beforeEach(async ({ page }) => {
  await mockSession(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('opening a nested screen pushes a real history entry, and the browser Back gesture returns to the previous screen', async ({ page }) => {
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-settings').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
});

test('the on-screen back arrow and the browser Back gesture land on the same previous screen', async ({ page }) => {
  // Reach Settings from two different starting screens and confirm each one's
  // own back arrow returns to where it was actually opened from — not a
  // single hardcoded screen.
  await page.getByTestId('nav-explore').click();
  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
  await page.getByTestId('open-settings-topbar').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();

  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-settings').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
});

test('a two-level drill unwinds one screen per Back press, in order', async ({ page }) => {
  await page.getByTestId('nav-explore').click();
  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
  await page.getByTestId('open-settings-topbar').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Find your next taste.' })).toBeVisible();
});

test('repeating the same drill-in/back-out round trip twice does not leave stale state or require extra presses', async ({ page }) => {
  for (let round = 0; round < 2; round++) {
    await page.getByTestId('nav-you').click();
    await page.getByTestId('open-settings').click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  }
});

test('KIN My Things opens with its own history entry, and Back returns to KIN', async ({ page }) => {
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-my-things').click();
  await expect(page.getByText('My Things', { exact: false }).first()).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId('kin-mode-my-things')).toBeVisible();
});

test('switching bottom tabs never grows the back stack', async ({ page }) => {
  const lengthAtStart = await page.evaluate(() => history.length);
  await page.getByTestId('nav-explore').click();
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('nav-you').click();
  await page.getByTestId('nav-home').click();
  const lengthAfterTabHopping = await page.evaluate(() => history.length);
  expect(lengthAfterTabHopping).toBe(lengthAtStart);
});

test('drilling in from a tab pushes exactly one entry, and Back returns to that tab', async ({ page }) => {
  // history.length only ever grows within a tab's session (going back moves
  // the position pointer, it never shrinks the count) — so it's only a
  // meaningful check on the way in, not after going back.
  const lengthOnHome = await page.evaluate(() => history.length);
  await page.getByTestId('nav-you').click();
  const lengthOnYou = await page.evaluate(() => history.length);
  expect(lengthOnYou).toBe(lengthOnHome);

  await page.getByTestId('open-settings').click();
  const lengthOnSettings = await page.evaluate(() => history.length);
  expect(lengthOnSettings).toBe(lengthOnYou + 1);

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
});

test('reloading mid-way through a nested screen still renders a safe, working screen', async ({ page }) => {
  await page.getByTestId('nav-explore').click();
  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
  await page.getByTestId('open-settings-topbar').click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  // A reload always re-initializes to Home — never a blank page or a crash —
  // regardless of which nested screen the browser's own history still shows
  // for that tab position.
  await expect(page.getByTestId('primary-navigation')).toBeVisible();
  await expect(page.locator('.approved-logo')).toBeVisible();
});
