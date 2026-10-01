import { expect, test, type Page } from '@playwright/test';

// The creator profile layout below the header: Featured collections (with
// "View all" opening the full Collections screen) at the top, then the
// category filters, then the Edits photo grid — with no "Edits | Collections"
// section tab row anywhere, for the owner and for a visitor, in English and
// in Arabic/RTL. A browser-history entry recorded by an older build for the
// retired About screen still lands on this same profile.

const quietTailoring = {
  id: 'quiet-tailoring', category: 'Fashion', title: 'Quiet tailoring', titleAr: 'أناقة هادئة',
  caption: 'A soft-structured look for a long city day.', captionAr: 'إطلالة مريحة ليوم طويل في المدينة.',
  image: '/tastekin-media/quiet-tailoring.webp', location: 'Mayfair, London', locationAr: 'مايفير، لندن',
  altText: 'Tailoring.', access: 'public', status: 'published', collectionIds: ['quiet-luxury'],
};

const coastalNotes = {
  id: 'coastal-notes', category: 'Travel', title: 'Coastal notes', titleAr: 'ملاحظات ساحلية',
  caption: 'The stay, the packing list, and where I ate.', captionAr: 'الإقامة والحقائب والأماكن.',
  image: '/tastekin-media/coastal-notes.webp', location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت',
  altText: 'Coast.', access: 'public', status: 'published', collectionIds: ['coastal-edit'],
};

const collections = [
  { id: 'quiet-luxury', title: 'Quiet Luxury', titleAr: 'فخامة هادئة', description: '', descriptionAr: '', access: 'public', coverEditId: 'quiet-tailoring', editIds: ['quiet-tailoring'] },
  { id: 'coastal-edit', title: 'The Coastal Edit', titleAr: 'اختيارات الساحل', description: '', descriptionAr: '', access: 'public', coverEditId: 'coastal-notes', editIds: ['coastal-notes'] },
];

const ownerProfile = {
  displayName: 'Fheed Alaiban', username: 'fheed', bio: 'A considered edit of fashion, places and travel.',
  city: 'Kuwait City', country: 'Kuwait', interests: ['Fashion', 'Travel'], avatar: '', avatarObjectPath: null,
  age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1,
};

const nouraProfile = {
  displayName: 'Noura Studio', username: 'noura.studio', bio: 'Restaurants and quiet corners of the city.',
  city: 'Kuwait City', country: 'Kuwait', interests: ['Restaurants', 'Places'], avatar: '', avatarObjectPath: null,
  age: null, dateOfBirth: null, showAge: false, verified: false, revision: 1,
};

const exploreBody = {
  authenticated: true,
  sort: 'best',
  creators: [
    { id: 'fheed-alaiban', username: 'fheed', displayName: 'Fheed Alaiban', avatar: '', categories: ['Fashion'], matchScore: null, matchReasons: [] },
    { id: 'noura-studio', username: 'noura.studio', displayName: 'Noura Studio', avatar: '', categories: ['Restaurants'], matchScore: null, matchReasons: [] },
  ],
  edits: [],
};

const FILTERS_EN = ['All', 'Stays', 'Food', 'Places', 'Tips', 'Style'];
const FILTERS_AR = ['الكل', 'إقامات', 'طعام', 'أماكن', 'نصائح', 'ستايل'];

async function mockOwnerSession(page: Page, language: 'en' | 'ar' = 'en') {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tastekin:')) localStorage.removeItem(key);
    }
  });
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        user: { id: 'profile-layout-user', email: 'profile-layout@tastekin.test' },
        role: 'creator',
        language,
        creator: { id: 'fheed', handle: 'fheed', displayName: 'Fheed Alaiban', verified: true, ownsWorkspace: true },
        featureFlags: { my_circle: true },
      }),
    });
  });
  await page.route('**/api/creator-profile', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ownerProfile) });
  });
  await page.route('**/api/creator-workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ creatorId: 'fheed', revision: 1, edits: [quietTailoring, coastalNotes], collections }) });
  });
  await page.route('**/api/creator-featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: ['quiet-luxury', 'coastal-edit'] }) });
  });
  await page.route('**/api/creators/noura.studio/profile', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(nouraProfile) });
  });
  await page.route('**/api/creators/noura.studio/workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ edits: [quietTailoring, coastalNotes], collections }) });
  });
  await page.route('**/api/creators/noura.studio/featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: ['quiet-luxury', 'coastal-edit'] }) });
  });
  await page.route('**/api/creators/noura.studio/views', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/explore**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(exploreBody) });
  });
}

async function openOwnProfile(page: Page, ar = false) {
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: ar ? 'عرض الملف' : 'View profile' }).click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
}

async function openVisitorProfile(page: Page) {
  await page.getByTestId('nav-explore').click();
  await page.getByTestId('creator-noura.studio').click();
  await expect(page.getByRole('heading', { name: 'Noura Studio' })).toBeVisible();
}

// Featured collections → category filters → Edits grid, stacked in that
// order with nothing between them, and no section tab row anywhere on the
// profile.
async function expectProfileLayout(page: Page, filters: string[]) {
  const profile = page.locator('.creator-profile');
  await expect(profile).toBeVisible();
  await expect(profile.locator('.approved-tabs')).toHaveCount(0);
  await expect(profile.getByTestId('profile-section-tabs')).toHaveCount(0);
  await expect(profile.getByRole('button', { name: /^(Edits|Collections|التعديلات|المجموعات)$/ })).toHaveCount(0);

  const featured = profile.locator('.profile-featured');
  const filterRow = profile.locator('.profile-travel-tabs');
  const grid = profile.getByTestId('profile-edits-grid');
  await expect(featured).toBeVisible();
  await expect(filterRow).toBeVisible();
  await expect(grid).toBeVisible();

  // Featured collections keep both cards and "View all" (two featured, so
  // the link is shown), exactly as before.
  await expect(featured.locator('.profile-featured-card')).toHaveCount(2);
  await expect(featured.getByTestId('profile-featured-viewall')).toBeVisible();

  await expect(filterRow.getByRole('tab')).toHaveText(filters);
  await expect(filterRow.getByRole('tab', { selected: true })).toHaveText(filters[0]);
  await expect(grid).toHaveAttribute('data-active-category', 'All');
  await expect(grid.locator('.photo-grid-card')).toHaveCount(2);

  const order = await profile.evaluate((section) => {
    const top = (selector: string) => section.querySelector(selector)!.getBoundingClientRect().top;
    const bottom = (selector: string) => section.querySelector(selector)!.getBoundingClientRect().bottom;
    const between = (from: string, to: string) => {
      // Everything that renders between the end of `from` and the start of
      // `to`, by DOM order — should be nothing.
      const fromEl = section.querySelector(from)!;
      const toEl = section.querySelector(to)!;
      const siblings: string[] = [];
      let node = fromEl.nextElementSibling;
      while (node && node !== toEl) { siblings.push(node.className); node = node.nextElementSibling; }
      return siblings;
    };
    return {
      featuredBottom: bottom('.profile-featured'), filtersTop: top('.profile-travel-tabs'),
      filtersBottom: bottom('.profile-travel-tabs'), gridTop: top('[data-testid="profile-edits-grid"]'),
      betweenFeaturedAndFilters: between('.profile-featured', '.profile-travel-tabs'),
      betweenFiltersAndGrid: between('.profile-travel-tabs', '[data-testid="profile-edits-grid"]'),
    };
  });
  expect(order.betweenFeaturedAndFilters).toEqual([]);
  expect(order.betweenFiltersAndGrid).toEqual([]);
  expect(order.filtersTop).toBeGreaterThanOrEqual(order.featuredBottom);
  expect(order.gridTop).toBeGreaterThanOrEqual(order.filtersBottom);
}

test.describe('English', () => {
  test.beforeEach(async ({ page }) => {
    await mockOwnerSession(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('owner profile: Featured collections, then the category filters, then the Edits grid, with no section tab row', async ({ page }) => {
    await openOwnProfile(page);
    await expectProfileLayout(page, FILTERS_EN);
    await expect(page.locator('.profile-bio')).toHaveText(ownerProfile.bio);
  });

  test('visitor profile uses the same layout with no section tab row', async ({ page }) => {
    await openVisitorProfile(page);
    await expectProfileLayout(page, FILTERS_EN);
    await expect(page.locator('.profile-bio')).toHaveText(nouraProfile.bio);
  });

  test('"View all" still opens the full Collections screen, which has no section tab row either, and Back returns to the profile', async ({ page }) => {
    await openOwnProfile(page);
    await page.getByTestId('profile-featured-viewall').click();
    await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
    await expect(page.locator('.approved-tabs')).toHaveCount(0);
    await expect(page.locator('.approved-collection')).toHaveCount(2);

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
    await expectProfileLayout(page, FILTERS_EN);
  });

  test('the category filters still drive the grid without any tab row in between', async ({ page }) => {
    await openOwnProfile(page);
    await page.getByTestId('profile-travel-tab-Style').click();
    const grid = page.getByTestId('profile-edits-grid');
    await expect(grid).toHaveAttribute('data-active-category', 'Style');
    await expect(grid.locator('.photo-grid-card')).toHaveCount(1);
    await page.getByTestId('profile-travel-tab-All').click();
    await expect(grid.locator('.photo-grid-card')).toHaveCount(2);
  });

  test('a history entry saved for the retired About screen restores this same profile layout', async ({ page }) => {
    await openOwnProfile(page);
    await page.getByTestId('profile-featured-viewall').click();
    await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();

    await page.evaluate(() => {
      window.history.pushState({ screen: 'about' }, '');
      window.history.pushState({ screen: 'settings' }, '');
    });
    await page.goBack();

    await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
    await expectProfileLayout(page, FILTERS_EN);
    await expect(page.getByText('Taste pillars')).toHaveCount(0);
  });
});

test.describe('Arabic', () => {
  test.beforeEach(async ({ page }) => {
    await mockOwnerSession(page, 'ar');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
  });

  test('owner profile in RTL: Featured collections, filters, grid, no section tab row; "عرض الكل" opens the Collections screen', async ({ page }) => {
    await openOwnProfile(page, true);
    await expectProfileLayout(page, FILTERS_AR);
    await expect(page.getByTestId('profile-featured-viewall')).toHaveText('عرض الكل');

    await page.getByTestId('profile-featured-viewall').click();
    await expect(page.getByRole('heading', { name: 'المجموعات' })).toBeVisible();
    await expect(page.locator('.approved-tabs')).toHaveCount(0);
  });
});
