import { expect, test, type Page } from '@playwright/test';
import { mapsHref, parseCoordinates } from '../src/maps-link';

// Post detail page and creator profile grid, at a 390×844 phone viewport:
//  - the caption sits above the image, centered, smaller on phones, at most
//    two lines;
//  - the location appears exactly once, as one small row above the image,
//    and tapping it opens the saved place in the device's maps app
//    (coordinates when the creator's maps link carries any, otherwise the
//    place name);
//  - the creator profile grid shows image-only thumbnails: no caption,
//    location, name or rating drawn over a photo.

const LONG_CAPTION = 'A long slow morning that starts with coffee by the water, wanders through the old souq for spices and cotton, and ends with grilled fish under the string lights of the corniche.';

const STYLE_EDIT = {
  id: 'style-1', category: 'Fashion', title: 'Quiet tailoring', titleAr: 'خياطة هادئة', caption: LONG_CAPTION, captionAr: 'صباح بطيء وطويل يبدأ بالقهوة قرب الماء ويمر بالسوق القديم وينتهي بسمك مشوي تحت أضواء الكورنيش.',
  image: '/tastekin-media/quiet-tailoring.webp', location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'Tailoring.',
  mapsUrl: 'https://www.google.com/maps/place/Souq+Al-Mubarakiya/@29.3759,47.9774,17z/data=!3m1!4b1', access: 'public', status: 'published', collectionIds: [],
};
const PLACE_EDIT = {
  id: 'place-1', category: 'Restaurants', title: 'Septime', titleAr: 'سبتيم', caption: 'Modern French cooking in a relaxed dining room.', captionAr: 'مطبخ فرنسي حديث في صالة مريحة.',
  image: '/tastekin-media/coastal-notes.webp', location: '', locationAr: '', altText: 'Dinner.', placeName: 'Septime', locationLabel: 'Paris, France', mapsUrl: null,
  tasteRating: 4, creatorReview: 'Book two weeks ahead; the tasting menu is the point.', access: 'public', status: 'published', collectionIds: [],
};
const PLACE_NO_CAPTION_EDIT = {
  ...PLACE_EDIT, id: 'place-2', caption: '', captionAr: '', placeName: 'Café de Flore', locationLabel: 'Saint-Germain, Paris', mapsUrl: 'https://maps.apple.com/?ll=48.8541,2.3325&q=Caf%C3%A9%20de%20Flore', tasteRating: 5, creatorReview: '',
};

function feedItem(edit: Record<string, unknown>) {
  return { creatorUsername: 'fheed', creatorName: 'Fheed Alaiban', creatorVerified: true, creatorAvatar: '/tastekin-media/fheed-profile.webp', following: false, edit };
}

async function visitorFeed(page: Page, language: 'en' | 'ar' = 'en') {
  await page.addInitScript(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('tastekin:')) localStorage.removeItem(key); });
  await page.route('**/api/me', async (route) => route.fulfill({ json: { user: { id: 'visitor-1', email: 'visitor@tastekin.test' }, role: 'consumer', creator: null, isAdmin: false, language, featureFlags: {}, needsOnboarding: false, onboardingStep: 'done' } }));
  await page.route('**/api/public-feed', async (route) => route.fulfill({ json: { items: [feedItem(STYLE_EDIT), feedItem(PLACE_EDIT), feedItem(PLACE_NO_CAPTION_EDIT)] } }));
  await page.route('**/api/edits/*/engagement', async (route) => route.fulfill({ json: { editId: 'x', likeCount: 0, commentCount: 0, liked: false, saved: false } }));
  await page.route('**/api/edits/*/comments', async (route) => route.fulfill({ json: [] }));
  await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-home').click();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

test.use({ viewport: { width: 390, height: 844 } });

test('maps links: coordinates are read from Google and Apple links, and each platform gets its own maps-app link, with the name as fallback', async () => {
  expect(parseCoordinates('https://www.google.com/maps/place/Souq/@29.3759,47.9774,17z/data=!3m1')).toEqual({ lat: 29.3759, lng: 47.9774 });
  expect(parseCoordinates('https://www.google.com/maps/place/X/data=!3m1!4b1!4m5!3m4!1s0x0!8m2!3d48.8534!4d2.381')).toEqual({ lat: 48.8534, lng: 2.381 });
  expect(parseCoordinates('https://www.google.com/maps/search/?api=1&query=48.8534,2.3810')).toEqual({ lat: 48.8534, lng: 2.381 });
  expect(parseCoordinates('https://maps.google.com/?q=29.3759%2C47.9774')).toEqual({ lat: 29.3759, lng: 47.9774 });
  expect(parseCoordinates('https://maps.apple.com/?ll=48.8541,2.3325&q=Flore')).toEqual({ lat: 48.8541, lng: 2.3325 });
  expect(parseCoordinates('https://maps.app.goo.gl/AbCdEf')).toBeNull();
  expect(parseCoordinates('https://www.google.com/maps/search/?api=1&query=Septime%2C+Paris')).toBeNull();
  expect(parseCoordinates('https://example.com/@999,999')).toBeNull();
  expect(parseCoordinates(null)).toBeNull();

  const coords = { lat: 29.3759, lng: 47.9774 };
  expect(mapsHref({ name: 'Souq Al-Mubarakiya, Kuwait City', coordinates: coords }, 'ios')).toBe('https://maps.apple.com/?ll=29.3759,47.9774&q=Souq%20Al-Mubarakiya%2C%20Kuwait%20City');
  expect(mapsHref({ name: 'Souq Al-Mubarakiya, Kuwait City', coordinates: coords }, 'android')).toBe('geo:29.3759,47.9774?q=29.3759,47.9774(Souq%20Al-Mubarakiya%2C%20Kuwait%20City)');
  expect(mapsHref({ name: 'Souq Al-Mubarakiya, Kuwait City', coordinates: coords }, 'web')).toBe('https://www.google.com/maps/search/?api=1&query=29.3759%2C47.9774');
  expect(mapsHref({ name: 'Septime, Paris, France', coordinates: null }, 'ios')).toBe('https://maps.apple.com/?q=Septime%2C%20Paris%2C%20France');
  expect(mapsHref({ name: 'Septime, Paris, France', coordinates: null }, 'android')).toBe('geo:0,0?q=Septime%2C%20Paris%2C%20France');
  expect(mapsHref({ name: 'Septime, Paris, France', coordinates: null }, 'web')).toBe('https://www.google.com/maps/search/?api=1&query=Septime%2C%20Paris%2C%20France');
});

test('post detail: caption centered above the image (two lines max, small on phones), one tappable location row above the image using the link\'s coordinates, nothing repeated below', async ({ page }) => {
  await visitorFeed(page);
  await page.getByTestId('edit-title-style-1').click();

  const caption = page.getByTestId('edit-detail-caption');
  await expect(caption).toHaveText(LONG_CAPTION);
  const captionStyle = await caption.evaluate((el) => { const s = getComputedStyle(el); return { textAlign: s.textAlign, clamp: s.webkitLineClamp, fontSize: parseFloat(s.fontSize), lineHeight: parseFloat(s.lineHeight) }; });
  expect(captionStyle.textAlign).toBe('center');
  expect(captionStyle.clamp).toBe('2');
  expect(captionStyle.fontSize).toBeLessThanOrEqual(20);
  const captionBox = (await caption.boundingBox())!;
  expect(captionBox.height).toBeLessThanOrEqual(captionStyle.lineHeight * 2 + 2);

  // Exactly one location, above the image, tappable, opening the maps app with the link's coordinates.
  const location = page.getByTestId('edit-detail-location');
  await expect(location).toHaveCount(1);
  await expect(location).toHaveText('Kuwait City, Kuwait');
  await expect(page.locator('[data-testid="edit-detail-caption"] ~ [data-testid="edit-detail-location"] ~ .approved-detail-art')).toHaveCount(1);
  await expect(location).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=29.3759%2C47.9774');
  await expect(location).toHaveAttribute('target', '_blank');
  expect(((await location.getAttribute('rel')) ?? '').split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  await expect(location).toHaveAttribute('aria-label', 'Open Kuwait City, Kuwait in Maps');
  const locationBox = (await location.boundingBox())!;
  const imageBox = (await page.locator('.approved-detail-art').boundingBox())!;
  expect(locationBox.y + locationBox.height).toBeLessThanOrEqual(imageBox.y);
  expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(locationBox.y);
  expect(locationBox.height).toBeLessThanOrEqual(40);
  await expect(page.getByText('Kuwait City, Kuwait')).toHaveCount(1);
  await expect(page.locator('.approved-location, .place-location, .place-map-link, .edit-detail-caption')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await shot(page, 'post-detail-style');
});

test('post detail: a place post shows "name · location" once, opens the maps app by name when the link has no coordinates, and keeps rating and review below the image', async ({ page }) => {
  await visitorFeed(page);
  await page.getByTestId('edit-title-place-1').click();
  await expect(page.getByTestId('edit-detail-caption')).toHaveText('Modern French cooking in a relaxed dining room.');
  const location = page.getByTestId('edit-detail-location');
  await expect(location).toHaveText('Septime · Paris, France');
  await expect(location).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Septime%2C%20Paris%2C%20France');
  await expect(page.locator('[data-testid="edit-detail-location"] ~ .approved-detail-art')).toHaveCount(1);
  await expect(page.getByText('Paris, France')).toHaveCount(1);
  await expect(page.getByText('Septime', { exact: true })).toHaveCount(0);
  await expect(page.locator('.place-location, .place-map-link, .place-name')).toHaveCount(0);
  await expect(page.getByTestId('taste-rating-place-1')).toBeVisible();
  await expect(page.getByText('Book two weeks ahead; the tasting menu is the point.')).toBeVisible();
  await shot(page, 'post-detail-place');
});

test('post detail: a place post without a caption uses the place name as the caption, so the location row shows the location only, with coordinates from an Apple Maps link', async ({ page }) => {
  await visitorFeed(page);
  await page.getByTestId('edit-title-place-2').click();
  await expect(page.getByTestId('edit-detail-caption')).toHaveText('Café de Flore');
  const location = page.getByTestId('edit-detail-location');
  await expect(location).toHaveText('Saint-Germain, Paris');
  await expect(location).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=48.8541%2C2.3325');
  await expect(page.getByText('Café de Flore')).toHaveCount(1);
});

test('creator profile grid: image-only thumbnails, no caption, location, name or rating over any photo', async ({ page }) => {
  await page.addInitScript(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('tastekin:')) localStorage.removeItem(key); });
  const workspace = { creatorId: 'fheed', revision: 1, updatedAt: '2026-09-01T00:00:00.000Z', edits: [STYLE_EDIT, PLACE_EDIT, PLACE_NO_CAPTION_EDIT], collections: [] };
  const profile = { displayName: 'Fheed Alaiban', username: 'fheed', bio: 'A considered edit.', city: 'Kuwait City', country: 'Kuwait', interests: ['Fashion', 'Travel', 'Places'], avatar: '/tastekin-media/fheed-profile.webp', avatarObjectPath: null, coverImage: '', coverImageObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1 };
  await page.route('**/api/me', async (route) => route.fulfill({ json: { user: { id: 'visitor-1', email: 'visitor@tastekin.test' }, role: 'consumer', creator: null, isAdmin: false, language: 'en', featureFlags: {}, needsOnboarding: false, onboardingStep: 'done' } }));
  await page.route('**/api/public-feed', async (route) => route.fulfill({ json: { items: [feedItem(STYLE_EDIT), feedItem(PLACE_EDIT), feedItem(PLACE_NO_CAPTION_EDIT)] } }));
  await page.route('**/api/creators/fheed/workspace', async (route) => route.fulfill({ json: workspace }));
  await page.route('**/api/creators/fheed/profile', async (route) => route.fulfill({ json: profile }));
  await page.route('**/api/creators/fheed/featured-collections', async (route) => route.fulfill({ json: { collectionIds: [] } }));
  await page.route('**/api/creators/fheed/views', async (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/creator-workspace', async (route) => route.fulfill({ json: workspace }));
  await page.route('**/api/creator-profile', async (route) => route.fulfill({ json: profile }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-home').click();
  // Open the creator's profile from a feed card's attribution.
  await page.getByTestId('edit-card-style-1').getByRole('button', { name: /Fheed Alaiban/ }).first().click();
  await expect(page.getByTestId('profile-edits-grid')).toBeVisible();

  const photoTiles = page.locator('[data-testid="profile-edits-grid"] .photo-grid-card');
  await expect(photoTiles).toHaveCount(3);
  for (const tile of await photoTiles.all()) {
    await expect(tile.locator('img')).toHaveCount(1);
    expect((await tile.innerText()).trim()).toBe('');
    await expect(tile.locator('.place-grid-photo-overlay, .profile-grid-caption, strong, .taste-rating-wrap')).toHaveCount(0);
  }
  await expect(page.locator('[data-testid="profile-edits-grid"]')).not.toContainText('Septime');
  await expect(page.locator('[data-testid="profile-edits-grid"]')).not.toContainText('Paris');
  await expect(page.locator('[data-testid="profile-edits-grid"]')).not.toContainText('Kuwait');
  await expectNoHorizontalOverflow(page);
  await shot(page, 'profile-grid');
});

test('Arabic/RTL: the caption and the single location row read correctly above the image', async ({ page }) => {
  await visitorFeed(page, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('edit-title-style-1').click();
  await expect(page.getByTestId('edit-detail-caption')).toHaveText(STYLE_EDIT.captionAr);
  const location = page.getByTestId('edit-detail-location');
  await expect(location).toHaveText('مدينة الكويت، الكويت');
  await expect(location).toHaveAttribute('aria-label', 'افتح مدينة الكويت، الكويت في الخرائط');
  await expect(page.locator('[data-testid="edit-detail-location"] ~ .approved-detail-art')).toHaveCount(1);
  await expect(page.getByText('مدينة الكويت، الكويت')).toHaveCount(1);
  expect((await page.getByTestId('edit-detail-caption').evaluate((el) => getComputedStyle(el).textAlign))).toBe('center');
  await expectNoHorizontalOverflow(page);
  await shot(page, 'post-detail-ar');
});
