import { expect, test, type Page } from '@playwright/test';
import { mapsHref, parseCoordinates } from '../src/maps-link';

// Post detail page and creator profile grid, at a 390×844 phone viewport:
//  - the image comes first, directly under the top bar, full column width,
//    its crop ratio and rounded corners untouched, nothing drawn over it;
//  - the caption sits below the image as plain ~16px regular text, never
//    clamped, start-aligned (left in English, right in Arabic);
//  - the location appears exactly once, as one small ~14px row directly
//    below the caption with the wine pin, and tapping it opens the saved
//    place in the device's maps app (coordinates when the creator's maps
//    link carries any, otherwise the place name);
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

test('post detail: image first, then the full caption as 16px start-aligned text (never clamped), then one tappable location row using the link\'s coordinates, nothing repeated', async ({ page }) => {
  await visitorFeed(page);
  await page.getByTestId('edit-title-style-1').click();

  const caption = page.getByTestId('edit-detail-caption');
  await expect(caption).toHaveText(LONG_CAPTION);
  const captionStyle = await caption.evaluate((el) => { const s = getComputedStyle(el); return { textAlign: s.textAlign, clamp: s.webkitLineClamp, overflow: s.overflow, textOverflow: s.textOverflow, fontSize: parseFloat(s.fontSize), fontWeight: s.fontWeight, lineHeight: parseFloat(s.lineHeight), clipped: el.scrollHeight > el.clientHeight + 1 }; });
  expect(captionStyle.textAlign).toBe('start');
  expect(captionStyle.fontSize).toBe(16);
  expect(captionStyle.fontWeight).toBe('400');
  // The whole caption is shown: no line clamp, no ellipsis, nothing cut off.
  expect(captionStyle.clamp).toBe('none');
  expect(captionStyle.overflow).toBe('visible');
  expect(captionStyle.textOverflow).toBe('clip');
  expect(captionStyle.clipped).toBe(false);
  const captionBox = (await caption.boundingBox())!;
  expect(captionBox.height).toBeGreaterThan(captionStyle.lineHeight * 3);

  // Exactly one location, below the caption, tappable, opening the maps app with the link's coordinates.
  const location = page.getByTestId('edit-detail-location');
  await expect(location).toHaveCount(1);
  await expect(location).toHaveText('Kuwait City, Kuwait');
  await expect(page.locator('.approved-detail-art ~ [data-testid="edit-detail-caption"] ~ [data-testid="edit-detail-location"]')).toHaveCount(1);
  const locationStyle = await location.evaluate((el) => { const s = getComputedStyle(el); const pin = el.querySelector('svg'); return { fontSize: parseFloat(s.fontSize), color: s.color, pinColor: pin ? getComputedStyle(pin).color : '', justify: s.justifyContent }; });
  expect(locationStyle.fontSize).toBe(14);
  expect(locationStyle.justify).toBe('flex-start');
  expect(locationStyle.color).not.toBe(locationStyle.pinColor);
  await expect(location).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=29.3759%2C47.9774');
  await expect(location).toHaveAttribute('target', '_blank');
  expect(((await location.getAttribute('rel')) ?? '').split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  await expect(location).toHaveAttribute('aria-label', 'Open Kuwait City, Kuwait in Maps');
  const locationBox = (await location.boundingBox())!;
  const imageBox = (await page.locator('.approved-detail-art').boundingBox())!;
  const topbarBox = (await page.locator('.approved-topbar').boundingBox())!;
  // Order: top bar → image (full column width, nothing above it) → caption → location, with short gaps.
  expect(imageBox.y).toBeGreaterThanOrEqual(topbarBox.y + topbarBox.height);
  expect(imageBox.y - (topbarBox.y + topbarBox.height)).toBeLessThanOrEqual(24);
  const shellBox = (await page.locator('.approved-shell').boundingBox())!;
  expect(imageBox.width).toBeGreaterThanOrEqual(shellBox.width - 34);
  expect(captionBox.y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height);
  expect(captionBox.y - (imageBox.y + imageBox.height)).toBeLessThanOrEqual(20);
  expect(locationBox.y).toBeGreaterThanOrEqual(captionBox.y + captionBox.height);
  expect(locationBox.y - (captionBox.y + captionBox.height)).toBeLessThanOrEqual(12);
  expect(locationBox.height).toBeLessThanOrEqual(32);
  // Left-aligned in English: caption and location start at the column's left edge, as the image does.
  expect(Math.abs(captionBox.x - imageBox.x)).toBeLessThan(2);
  expect(Math.abs(locationBox.x - imageBox.x)).toBeLessThan(2);
  await expect(page.locator('.approved-detail-art *:not(img)')).toHaveCount(0);
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
  await expect(page.locator('.approved-detail-art ~ [data-testid="edit-detail-caption"] ~ [data-testid="edit-detail-location"]')).toHaveCount(1);
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

test('Arabic/RTL: image first, then the caption and the single location row, both right-aligned', async ({ page }) => {
  await visitorFeed(page, 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('edit-title-style-1').click();
  await expect(page.getByTestId('edit-detail-caption')).toHaveText(STYLE_EDIT.captionAr);
  const location = page.getByTestId('edit-detail-location');
  await expect(location).toHaveText('مدينة الكويت، الكويت');
  await expect(location).toHaveAttribute('aria-label', 'افتح مدينة الكويت، الكويت في الخرائط');
  await expect(page.locator('.approved-detail-art ~ [data-testid="edit-detail-caption"] ~ [data-testid="edit-detail-location"]')).toHaveCount(1);
  await expect(page.getByText('مدينة الكويت، الكويت')).toHaveCount(1);
  expect((await page.getByTestId('edit-detail-caption').evaluate((el) => getComputedStyle(el).textAlign))).toBe('start');
  const imageBox = (await page.locator('.approved-detail-art').boundingBox())!;
  const captionBox = (await page.getByTestId('edit-detail-caption').boundingBox())!;
  const locationBox = (await location.boundingBox())!;
  expect(captionBox.y).toBeGreaterThanOrEqual(imageBox.y + imageBox.height);
  expect(locationBox.y).toBeGreaterThanOrEqual(captionBox.y + captionBox.height);
  // Right-aligned in Arabic: the location row ends at the column's right edge, as the image does.
  expect(Math.abs((locationBox.x + locationBox.width) - (imageBox.x + imageBox.width))).toBeLessThan(2);
  const pinBox = (await location.locator('svg').boundingBox())!;
  expect(pinBox.x + pinBox.width).toBeGreaterThan(locationBox.x + locationBox.width - 20);
  await expectNoHorizontalOverflow(page);
  await shot(page, 'post-detail-ar');
});
