import { expect, test, type Page, type Route } from '@playwright/test';

// "Trips" is retired from the user-facing app, at a 390×844 phone viewport:
//  - the creator profile filter row is exactly All, Stays, Food, Places,
//    Tips, Style (English and Arabic);
//  - the composer offers Stays, Food, Places, Tips, Style — no Trips;
//  - a legacy post still stored under the backend `Travel` category is not
//    deleted or migrated: it stays visible under All and inside its
//    collection, is filtered out by every other tab, and when its owner
//    edits it the composer explains the retired category instead of
//    offering "Trips" again;
//  - the profile grid itself (image-only tiles, sizes, aspect ratio) is
//    unchanged by the tab change.

const ownerSession = 'tastekin-e2e-owner';
const onePixelImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==', 'base64');

type Edit = Record<string, unknown> & { id: string; category: string; status: string; collectionIds: string[]; image?: string };

function makeEdit(id: string, category: string, title: string, image: string, collectionIds: string[] = []): Edit {
  return { id, category, title, titleAr: title, caption: title, captionAr: title, image, location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: title, access: 'public', status: 'published', collectionIds };
}

const EDITS: Edit[] = [
  makeEdit('legacy-trip', 'Travel', 'A slow coastal itinerary', '/tastekin-media/coastal-notes.webp', ['coastal-edit']),
  makeEdit('stay-1', 'Decor', 'A calm hotel room', '/tastekin-media/sunday-reset.webp'),
  makeEdit('food-1', 'Restaurants', 'What I ordered', '/tastekin-media/what-i-ordered.webp'),
  makeEdit('place-1', 'Places', 'Places worth returning to', '/tastekin-media/places-returning.webp'),
  makeEdit('tip-1', 'DailyRoutine', 'Sunday reset', '/tastekin-media/hotel-breakfast-source.webp'),
  makeEdit('style-1', 'Fashion', 'Quiet tailoring', '/tastekin-media/quiet-tailoring.webp'),
];
const COLLECTIONS = [
  { id: 'coastal-edit', title: 'The Coastal Edit', titleAr: 'اختيارات الساحل', description: '', descriptionAr: '', access: 'public', coverEditId: 'legacy-trip', editIds: ['legacy-trip'] },
];
const EXPECTED_TABS = ['All', 'Stays', 'Food', 'Places', 'Tips', 'Style'];
const EXPECTED_TABS_AR = ['الكل', 'إقامات', 'طعام', 'أماكن', 'نصائح', 'ستايل'];
const EXPECTED_CHIPS = ['Stays', 'Food', 'Places', 'Tips', 'Style'];
const EXPECTED_CHIPS_AR = ['إقامات', 'طعام', 'أماكن', 'نصائح', 'ستايل'];

class OwnerApi {
  workspace = { creatorId: 'fheed', revision: 3, updatedAt: '2026-09-01T00:00:00.000Z', edits: EDITS, collections: COLLECTIONS };
  readonly savedPayloads: Array<{ edits: Edit[]; collections: unknown[] }> = [];
  constructor(private language: 'en' | 'ar' = 'en') {}

  async attach(page: Page) {
    await page.route('**/api/**', async (route) => this.handle(route, new URL(route.request().url())));
  }

  private body(route: Route) { const raw = route.request().postData(); return raw ? JSON.parse(raw) as Record<string, unknown> : {}; }

  private async handle(route: Route, url: URL) {
    const method = route.request().method();
    if (url.pathname === '/api/me') {
      await route.fulfill({ json: { user: { id: 'fheed-owner', email: 'founder@tastekin.test' }, role: 'creator', creator: { id: 'fheed', handle: 'fheed', displayName: 'Fheed Alaiban', verified: true, ownsWorkspace: true }, isAdmin: false, language: this.language, featureFlags: {}, needsOnboarding: false, onboardingStep: 'done' } });
      return;
    }
    if (url.pathname === '/api/creator-workspace' || url.pathname === '/api/creators/fheed/workspace') {
      if (method === 'PUT') {
        const payload = this.body(route) as { edits: Edit[]; collections: unknown[]; expectedRevision: number };
        this.savedPayloads.push(payload);
        this.workspace = { ...this.workspace, edits: payload.edits, collections: payload.collections as typeof COLLECTIONS, revision: this.workspace.revision + 1 };
      }
      await route.fulfill({ json: this.workspace });
      return;
    }
    if (url.pathname === '/api/creator-profile' || url.pathname === '/api/creators/fheed/profile') {
      await route.fulfill({ json: { displayName: 'Fheed Alaiban', username: 'fheed', bio: '', city: 'Kuwait City', country: 'Kuwait', interests: ['Fashion', 'Travel', 'Places'], avatar: '/tastekin-media/fheed-profile.webp', avatarObjectPath: null, coverImage: '', coverImageObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: this.workspace.revision } });
      return;
    }
    if (url.pathname === '/api/creator-featured-collections' || url.pathname === '/api/creators/fheed/featured-collections') { await route.fulfill({ json: { collectionIds: [] } }); return; }
    if (url.pathname.match(/^\/api\/edits\/[^/]+\/engagement$/)) { await route.fulfill({ json: { editId: 'x', likeCount: 0, commentCount: 0, liked: false, saved: false } }); return; }
    if (url.pathname.match(/^\/api\/edits\/[^/]+\/comments$/)) { await route.fulfill({ json: [] }); return; }
    if (url.pathname.startsWith('/api/storage/objects/') || url.pathname.startsWith('/api/public-media/') || url.pathname.startsWith('/api/public-profile-media')) { await route.fulfill({ status: 200, contentType: 'image/png', body: onePixelImage }); return; }
    if (url.pathname === '/api/public-feed') { await route.fulfill({ json: { items: [] } }); return; }
    await route.fulfill({ status: 404, json: { error: 'Not found' } });
  }
}

async function ownerProfile(page: Page, api: OwnerApi, language: 'en' | 'ar' = 'en') {
  await page.context().addCookies([{ name: 'sid', value: ownerSession, url: 'http://127.0.0.1:23385' }]);
  await api.attach(page);
  await page.goto(language === 'ar' ? '/?lang=ar' : '/');
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: language === 'ar' ? 'عرض الملف' : 'View profile' }).click();
  await expect(page.getByTestId('profile-edits-grid')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

test.use({ viewport: { width: 390, height: 844 } });

test('profile filter row is exactly All, Stays, Food, Places, Tips, Style; a legacy Travel post shows under All only and inside its collection', async ({ page }) => {
  const api = new OwnerApi();
  await ownerProfile(page, api);

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(EXPECTED_TABS);
  await expect(page.getByTestId('profile-travel-tab-Trips')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Trips' })).toHaveCount(0);

  // All: every published post, including the legacy Travel one — the grid is untouched.
  const grid = page.getByTestId('profile-edits-grid');
  await expect(grid).toHaveAttribute('data-active-category', 'All');
  await expect(grid.locator('.photo-grid-card')).toHaveCount(EDITS.length);
  await expect(page.getByTestId('profile-edit-legacy-trip')).toBeVisible();
  const tile = page.getByTestId('profile-edit-legacy-trip');
  const box = (await tile.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(3 / 4, 1);
  expect((await tile.innerText()).trim()).toBe('');
  await expectNoHorizontalOverflow(page);
  await shot(page, 'profile-tabs');

  // Every other tab filters the legacy post out and shows only its own category.
  const expectedByTab: Record<string, string> = { Stays: 'stay-1', Food: 'food-1', Places: 'place-1', Tips: 'tip-1', Style: 'style-1' };
  for (const [tab, id] of Object.entries(expectedByTab)) {
    await page.getByTestId(`profile-travel-tab-${tab}`).click();
    await expect(grid).toHaveAttribute('data-active-category', tab);
    await expect(grid.locator('.photo-grid-card')).toHaveCount(1);
    await expect(page.getByTestId(`profile-edit-${id}`)).toBeVisible();
    await expect(page.getByTestId('profile-edit-legacy-trip')).toHaveCount(0);
  }
  await page.getByTestId('profile-travel-tab-All').click();
  await expect(page.getByTestId('profile-edit-legacy-trip')).toBeVisible();

  // Inside its collection, untouched.
  await page.getByRole('button', { name: 'Collections', exact: true }).click();
  await page.locator('button.approved-collection', { hasText: 'The Coastal Edit' }).click();
  await expect(page.getByRole('heading', { name: 'The Coastal Edit' })).toBeVisible();
  await expect(page.locator('[data-edit-id="legacy-trip"]')).toHaveCount(1);
  expect(api.savedPayloads).toHaveLength(0);
});

test('composer offers Stays, Food, Places, Tips, Style — no Trips — and editing a legacy Travel post explains the retired category instead of offering it', async ({ page }) => {
  const api = new OwnerApi();
  await ownerProfile(page, api);

  // New post: chips in order, no Trips, nothing pre-selected.
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-creator-workspace').click();
  await expect(page.getByRole('heading', { name: 'Create an Edit' })).toBeVisible();
  const chips = page.getByRole('radiogroup', { name: 'Category' }).getByRole('radio');
  await expect(chips).toHaveText(EXPECTED_CHIPS);
  await expect(page.getByRole('radio', { name: 'Trips' })).toHaveCount(0);
  await expect(page.getByTestId('composer-legacy-category')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await shot(page, 'composer-categories');

  // Editing the legacy post: its stored category is kept, no chip is selected, and a note explains why.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await page.getByTestId('profile-edit-legacy-trip').click();
  await expect(page.getByTestId('edit-detail-caption')).toHaveText('A slow coastal itinerary');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create an Edit' })).toBeVisible();
  await expect(chips).toHaveText(EXPECTED_CHIPS);
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(page.getByTestId('composer-legacy-category')).toContainText('retired “Trips” category');
  await expect(page.getByRole('radio', { name: 'Trips' })).toHaveCount(0);

  // Publishing without touching the category keeps the stored value: nothing is migrated.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByTestId('open-creator-workspace')).toBeVisible();
  expect(api.savedPayloads.at(-1)!.edits.find((edit) => edit.id === 'legacy-trip')).toMatchObject({ category: 'Travel', status: 'published', collectionIds: ['coastal-edit'] });
});

test('Arabic: the filter row and composer chips are in the same order with no رحلات', async ({ page }) => {
  const api = new OwnerApi('ar');
  await ownerProfile(page, api, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('tab')).toHaveText(EXPECTED_TABS_AR);
  await expect(page.getByRole('tab', { name: 'رحلات' })).toHaveCount(0);
  await expect(page.getByTestId('profile-edit-legacy-trip')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot(page, 'profile-tabs-ar');

  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-creator-workspace').click();
  await expect(page.getByRole('radiogroup', { name: 'الفئة' }).getByRole('radio')).toHaveText(EXPECTED_CHIPS_AR);
  await expect(page.getByRole('radio', { name: 'رحلات' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
