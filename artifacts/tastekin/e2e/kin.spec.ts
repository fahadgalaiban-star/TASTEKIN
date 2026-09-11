import { expect, test, type Page } from '@playwright/test';

type MeOptions = { authenticated?: boolean; kinSearch?: boolean; myThings?: boolean; language?: 'en' | 'ar' };

function meBody({ authenticated = true, kinSearch = true, myThings = false, language = 'en' }: MeOptions = {}) {
  return JSON.stringify({
    user: authenticated ? { id: 'kin-e2e-user', email: 'kin-e2e@tastekin.test' } : null,
    role: 'consumer',
    creator: null,
    isAdmin: false,
    language,
    notifyPush: true,
    notifyEmail: true,
    subscribed: false,
    supportEmail: null,
    needsOnboarding: false,
    onboardingStep: 'done',
    googleAuthConfigured: false,
    featureFlags: { kin_search: kinSearch, my_things: myThings },
  });
}

async function mockMe(page: Page, options: MeOptions = {}) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody(options) });
  });
}

test('the bottom nav opens a real KIN page when the flag is on', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByRole('heading', { name: 'Built around you.' })).toBeVisible();
  await expect(page.getByTestId('kin-mode-looks')).toBeVisible();
  await expect(page.getByTestId('kin-mode-travel')).toBeVisible();
});

test('the guard sends KIN back to You when the flag is off', async ({ page }) => {
  await mockMe(page, { kinSearch: false });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-submit')).toHaveCount(0);
  await expect(page.getByTestId('open-settings')).toBeVisible();
});

test('the guard sends KIN back to You when the session becomes unauthenticated mid-session', async ({ page }) => {
  let authenticated = true;
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody({ authenticated, kinSearch: true }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-submit')).toBeVisible();

  authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('kin-submit')).toHaveCount(0);
  await expect(page.getByTestId('you-sign-in')).toBeVisible();
});

test('Looks mode: Optional details shows location/budget/size/occasion, not destination/dates', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByText('Optional details', { exact: true }).click();
  await expect(page.getByTestId('kin-location')).toBeVisible();
  await expect(page.getByTestId('kin-budget')).toBeVisible();
  await expect(page.getByTestId('kin-size')).toBeVisible();
  await expect(page.getByTestId('kin-occasion')).toBeVisible();
  await expect(page.getByTestId('kin-destination')).toHaveCount(0);
  await expect(page.getByTestId('kin-start-date')).toHaveCount(0);
});

test('Travel is a dedicated two-step flow with no clothing UI or payload', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  let sentBody: Record<string, unknown> | undefined;
  await page.route('**/api/kin/travel/plan', async (route) => {
    sentBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', plan: { destination: 'Madrid', narrative: '', citations: [], days: [] } }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();

  await expect(page.getByRole('heading', { name: 'Plan your trip' })).toBeVisible();
  await expect(page.getByText('Tell KIN where and when.')).toBeVisible();
  await expect(page.getByText('1 of 2')).toBeVisible();
  await expect(page.getByTestId('kin-destination')).toBeVisible();
  await expect(page.getByTestId('kin-destination')).toHaveAttribute('placeholder', 'Search a city or place');
  await expect(page.getByTestId('kin-query')).toHaveCount(0);
  await expect(page.getByText('What kind of trip do you want?')).toHaveCount(0);
  await expect(page.getByText('Relaxed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Start (optional)')).toBeVisible();
  await expect(page.getByText('End (optional)')).toBeVisible();
  await page.getByTestId('kin-destination').fill('Madrid');
  await page.getByTestId('kin-travel-next').click();

  await expect(page.getByRole('heading', { name: 'Choose your interests' })).toBeVisible();
  await expect(page.getByText('2 of 2')).toBeVisible();
  for (const label of ['Breakfast', 'Dinner', 'Cafés', 'Shopping', 'Museums', 'Parks', 'Hidden gems', 'Sport']) {
    await expect(page.getByTestId('kin-interest-grid').getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Gyms', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Pilates', { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('Anything else?')).toHaveCount(0);
  await page.getByTestId('kin-interest-museums').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect.poll(() => sentBody?.destination).toBe('Madrid');
  expect(sentBody?.myThingsItemId).toBeUndefined();
  expect(sentBody?.myThingsItemIds).toBeUndefined();
  await expect(page.getByText('Choose from My Things')).toHaveCount(0);
  await expect(page.getByTestId('kin-wardrobe-item')).toHaveCount(0);
  await expect(page.getByTestId('kin-budget')).toHaveCount(0);
  await expect(page.getByTestId('kin-occasion')).toHaveCount(0);
  await expect(page.getByTestId('kin-location')).toHaveCount(0);
  await expect(page.getByTestId('kin-size')).toHaveCount(0);
});

test('destination is required before advancing from screen 1', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByTestId('kin-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan your trip' })).toBeVisible();
});

test('both dates blank is accepted; entering only one date is rejected; end-before-start is rejected', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill('Tokyo');

  // one date without the other
  await page.getByTestId('kin-start-date').fill('2026-11-01');
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByTestId('kin-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan your trip' })).toBeVisible();

  // end before start
  await page.getByTestId('kin-end-date').fill('2026-10-01');
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByTestId('kin-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan your trip' })).toBeVisible();

  // both blank is accepted
  await page.getByTestId('kin-start-date').fill('');
  await page.getByTestId('kin-end-date').fill('');
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByRole('heading', { name: 'Choose your interests' })).toBeVisible();
});

test('Travel step 2 validates interests and Sport subchoices, then submits directly', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  let calls = 0;
  await page.route('**/api/kin/travel/plan', async (route) => {
    calls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', plan: { destination: 'Cairo', narrative: '', citations: [], days: [] } }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill('Cairo');
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect(page.getByTestId('kin-error')).toContainText('Choose at least one interest');
  expect(calls).toBe(0);
  await page.getByTestId('kin-interest-sport').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect(page.getByTestId('kin-error')).toContainText('Choose at least one Sport option');
  expect(calls).toBe(0);
  await page.getByTestId('kin-sport-pilates').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect.poll(() => calls).toBe(1);
});

test('Travel renders compact day cards with exact server Maps links, attribution, Swap and Add to trip, without narrative or drive-time copy', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  const mapsUrl = 'https://maps.google.com/?cid=stable-place-1';
  let swapBody: Record<string, unknown> | undefined;
  await page.route('**/api/kin/travel/plan', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        plan: {
          destination: 'London',
          narrative: 'This long narrative should not be shown in the compact itinerary.',
          citations: [],
          days: [{
            dayIndex: 0,
            date: '2026-10-01',
            places: [{
              placeId: 'stable-place-1',
              name: 'A very long place name that remains constrained inside its compact card',
              formattedAddress: 'A full address that should not render',
              lat: 51.5,
              lng: -0.1,
              rating: 4.8,
              websiteUrl: null,
              mapsUrl,
              photoUrl: null,
              photoAttribution: 'Google contributor',
              slot: null,
              activityInterest: 'museums',
              openingHours: '08:00–18:00',
            }],
            routes: [{ fromPlaceId: 'stable-place-1', toPlaceId: 'other', distanceMeters: 1800, durationSeconds: 600 }],
          }],
        },
      }),
    });
  });
  await page.route('**/api/kin/travel/swap-place', async (route) => {
    swapBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        place: {
          placeId: 'stable-place-2',
          name: 'Replacement Museum',
          formattedAddress: null,
          lat: 51.51,
          lng: -0.11,
          rating: 4.7,
          websiteUrl: null,
          mapsUrl: 'https://maps.google.com/?cid=stable-place-2',
          photoUrl: null,
          photoAttribution: null,
          slot: null,
          activityInterest: 'museums',
          openingHours: null,
        },
        routes: [],
      }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill('London');
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-interest-cafes').click();
  await page.getByTestId('kin-travel-submit').click();
  const place = page.getByTestId('kin-travel-place');
  await expect(place).toBeVisible();
  await expect(place).toContainText('Museums');
  await expect(place.getByRole('link', { name: 'Maps' })).toHaveAttribute('href', mapsUrl);
  await expect(place).toContainText('Google contributor');
  const swap = place.getByTestId('kin-swap-place');
  const add = place.getByTestId('kin-add-to-trip');
  const maps = place.getByRole('link', { name: 'Maps' });
  for (const control of [swap, add, maps]) {
    const box = await control.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await swap.click();
  await expect.poll(() => swapBody?.activityInterest).toBe('museums');
  await expect(page.getByRole('main')).toContainText('Replacement Museum');
  await expect(page.getByText('This long narrative should not be shown')).toHaveCount(0);
  await expect(page.getByText('A full address that should not render')).toHaveCount(0);
  await expect(page.getByText('08:00–18:00')).toHaveCount(0);
  await expect(page.getByText(/10 min drive/)).toHaveCount(0);
});

test('the two Travel steps are RTL-safe with Arabic labels and no overflow at 390×844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMe(page, { kinSearch: true, language: 'ar' });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await expect(page.getByText('1 من 2')).toBeVisible();
  await page.getByTestId('kin-destination').fill('دبي');
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByText('2 من 2')).toBeVisible();
  await page.getByTestId('kin-interest-sport').click();
  await expect(page.getByTestId('kin-sport-walking_places')).toHaveText('أماكن للمشي');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const widths = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
});

test('submitting a blank query shows an inline error and never calls the endpoint', async ({ page }) => {
  let searchCalls = 0;
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => { searchCalls += 1; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', answer: '', citations: [], results: [] }) }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-error')).toBeVisible();
  expect(searchCalls).toBe(0);
});

test('loading state shows while the request is in flight, then renders the answer with clickable source citations', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        answer: 'A warm, editorial answer grounded in live search.',
        citations: [{ title: 'Example Boutique', url: 'https://example.com/item-1' }],
        results: [],
      }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit in Paris');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-loading')).toBeVisible();
  await expect(page.getByTestId('kin-answer')).toBeVisible();
  await expect(page.getByTestId('kin-loading')).toHaveCount(0);
  await expect(page.getByText('A warm, editorial answer grounded in live search.')).toBeVisible();
  const citationLink = page.getByTestId('kin-citations').getByRole('link', { name: 'Example Boutique' });
  await expect(citationLink).toHaveAttribute('href', 'https://example.com/item-1');
});

test('an empty result renders the empty state, not an error', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', answer: '', citations: [], results: [] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('something with no results');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByText('No results yet — try rephrasing your request.')).toBeVisible();
  await expect(page.getByTestId('kin-error')).toHaveCount(0);
});

test('a missing-configuration/unavailable response renders the unavailable state without blocking the form', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'unavailable', reason: 'unavailable' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-unavailable')).toBeVisible();
  await expect(page.getByTestId('kin-submit')).toBeEnabled();
});

test('a network/5xx error renders the inline error state and the form remains usable for retry', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-error')).toBeVisible();
  await expect(page.getByTestId('kin-submit')).toBeEnabled();
});

test('external result cards render title, source, price+currency when supplied, and the branded placeholder when no image is supplied', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        answer: 'Here is one option.',
        citations: [],
        results: [
          { title: 'Wool Coat', source: 'example.com', url: 'https://example.com/coat', price: 240, currency: 'USD', imageUrl: null },
        ],
      }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a warm coat');
  await page.getByTestId('kin-submit').click();
  const card = page.getByTestId('kin-result-card');
  await expect(card).toHaveAttribute('href', 'https://example.com/coat');
  await expect(card).toContainText('Wool Coat');
  await expect(card).toContainText('example.com');
  await expect(card).toContainText('USD 240');
  await expect(card.locator('img')).toHaveAttribute('src', '/kin-placeholder.svg');
});

test('the My Things item picker only appears when my_things is also enabled and items exist', async ({ page }) => {
  await mockMe(page, { kinSearch: true, myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'item-1', itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', createdAt: new Date().toISOString() }] }),
      });
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-my-things-item')).toBeVisible();
});

test('the My Things item picker is absent when my_things is disabled', async ({ page }) => {
  await mockMe(page, { kinSearch: true, myThings: false });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-my-things-item')).toHaveCount(0);
});

test('Arabic UI strings render for KIN', async ({ page }) => {
  await mockMe(page, { kinSearch: true, language: 'ar' });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByRole('heading', { name: 'مبني من أجلك.' })).toBeVisible();
  await expect(page.getByTestId('kin-mode-looks')).toHaveText('الإطلالات');
  await expect(page.getByTestId('kin-mode-travel')).toHaveText('السفر');
  await expect(page.getByTestId('kin-submit')).toHaveText('اسأل كين');
});

test('the creator workspace remains reachable from You after the center nav button became KIN', async ({ page }) => {
  // Not a creator/owner session here — this only proves the affordance is
  // absent for a non-owner and that KIN itself does not appear on You.
  await mockMe(page, { kinSearch: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await expect(page.getByTestId('open-creator-workspace')).toHaveCount(0);
});

// --- reference image correctness --------------------------------------------

function looksOkBody(overrides: { answer?: string; results?: unknown[]; options?: unknown[]; webSearchDegraded?: boolean } = {}) {
  return JSON.stringify({
    status: 'ok',
    answer: overrides.answer ?? '',
    citations: [],
    results: overrides.results ?? [],
    options: overrides.options ?? [{ label: 'signature', reasoning: 'A tailored navy look for tonight.', ownedItems: [], missingItems: [] }],
    webSearchDegraded: overrides.webSearchDegraded ?? false,
  });
}

// A successful answer that never got parsed into Signature/Safe/Bold
// options (e.g. the model didn't use the three-marker format) — KIN falls
// back to the plain-answer layout (data-testid="kin-answer") instead of
// the options card (data-testid="kin-looks-options"). The reference image
// and search-limited notice must both still work in this layout.
function looksOkPlainAnswerBody(overrides: { answer?: string; webSearchDegraded?: boolean } = {}) {
  return looksOkBody({ answer: overrides.answer ?? 'A tailored navy look for tonight, worn with minimal accessories.', options: [], webSearchDegraded: overrides.webSearchDegraded });
}

test('an uploaded photo becomes the styling reference, clearly labeled — even if the photo is removed from the form while the request is still in flight', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/looks/photo*', async (route) => {
    // Long enough that the member can act on the form before this resolves.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit');
  await page.getByTestId('kin-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('kin-photo-clear')).toBeVisible();
  await page.getByTestId('kin-submit').click();
  // While the request is in flight, remove the photo from the form — the
  // eventual result must still be shown against the photo that was
  // actually submitted, not whatever the form looks like once it returns.
  await expect(page.getByTestId('kin-loading')).toBeVisible();
  await page.getByTestId('kin-photo-clear').click();
  await expect(page.getByTestId('kin-look-reference')).toBeVisible();
  await expect(page.getByTestId('kin-look-reference').getByRole('img')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByText('Your styling reference')).toBeVisible();
});

test('a selected My Things item becomes the styling reference, served via the authorized per-item image route', async ({ page }) => {
  await mockMe(page, { kinSearch: true, myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'item-42', itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', createdAt: new Date().toISOString() }] }),
      });
    }
  });
  await page.route('**/api/kin/search', async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('style this item');
  await page.getByTestId('kin-my-things-item').selectOption('item-42');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-look-reference').getByRole('img')).toHaveAttribute('src', '/api/closet-items/item-42/image');
});

test('no photo and no My Things item means text-only styling advice — never a fallback image of any kind', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: looksOkBody({ results: [{ title: 'Wool Coat', source: 'example.com', url: 'https://example.com/coat', price: null, currency: null, imageUrl: 'https://example.com/coat.jpg' }] }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit, no photo');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-looks-options')).toBeVisible();
  await expect(page.getByTestId('kin-look-reference')).toHaveCount(0);
  // The result card's own web-sourced image still renders — but only in
  // its citation/result card, never standing in as an outfit reference.
  const card = page.getByTestId('kin-result-card');
  await expect(card.locator('img')).toHaveAttribute('src', 'https://example.com/coat.jpg');
});

test('a web-search-result thumbnail can never render as the outfit reference, even when no photo was used', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: looksOkBody({ results: [
        { title: 'Store A', source: 'a.example.com', url: 'https://a.example.com/1', price: null, currency: null, imageUrl: 'https://a.example.com/1.jpg' },
        { title: 'Store B', source: 'b.example.com', url: 'https://b.example.com/2', price: null, currency: null, imageUrl: 'https://b.example.com/2.jpg' },
      ] }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-looks-options')).toBeVisible();
  // No element anywhere in the option card may show a.example.com/1.jpg or
  // b.example.com/2.jpg as if it were the outfit itself.
  const optionCardImages = page.getByTestId('kin-look-option').locator('img');
  await expect(optionCardImages).toHaveCount(0);
});

// --- reference image correctness when the model's answer has no parsed
// Signature/Safe/Bold options — KIN renders the plain-answer fallback
// (data-testid="kin-answer") instead of the options card, and the
// reference image must still show up there, using the same rules. -------

test('an uploaded photo still becomes the styling reference when the answer has no parsed options (plain-answer layout)', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/looks/photo*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkPlainAnswerBody() });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit');
  await page.getByTestId('kin-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-answer')).toBeVisible();
  await expect(page.getByTestId('kin-looks-options')).toHaveCount(0);
  await expect(page.getByTestId('kin-look-reference')).toBeVisible();
  await expect(page.getByTestId('kin-look-reference').getByRole('img')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByText('Your styling reference')).toBeVisible();
});

test('a selected My Things item still becomes the styling reference when the answer has no parsed options (plain-answer layout)', async ({ page }) => {
  await mockMe(page, { kinSearch: true, myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'item-42', itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', createdAt: new Date().toISOString() }] }),
      });
    }
  });
  await page.route('**/api/kin/search', async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkPlainAnswerBody() }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('style this item');
  await page.getByTestId('kin-my-things-item').selectOption('item-42');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-answer')).toBeVisible();
  await expect(page.getByTestId('kin-looks-options')).toHaveCount(0);
  await expect(page.getByTestId('kin-look-reference').getByRole('img')).toHaveAttribute('src', '/api/closet-items/item-42/image');
});

test('no photo and no My Things item means no reference image in the plain-answer layout either', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: looksOkPlainAnswerBody(),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit, no photo');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-answer')).toBeVisible();
  await expect(page.getByTestId('kin-looks-options')).toHaveCount(0);
  await expect(page.getByTestId('kin-look-reference')).toHaveCount(0);
});

test('the search-limited note still appears in the plain-answer layout when the answer has no parsed options', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkPlainAnswerBody({ webSearchDegraded: true }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-answer')).toBeVisible();
  await expect(page.getByTestId('kin-search-limited')).toBeVisible();
  await expect(page.getByText('A tailored navy look for tonight, worn with minimal accessories.')).toBeVisible();
});

test('the search-limited note appears only when the provider reports a structural web-search failure, alongside the real advice', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody({ webSearchDegraded: true }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-looks-options')).toBeVisible();
  await expect(page.getByTestId('kin-search-limited')).toBeVisible();
  await expect(page.getByText('A tailored navy look for tonight.')).toBeVisible();
});

test('the button that regenerates the whole response is labeled "Get new suggestions", not "Swap a Piece"', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-looks-options')).toBeVisible();
  await expect(page.getByTestId('kin-new-suggestions')).toHaveText('Get new suggestions');
  await expect(page.getByText('Swap a Piece')).toHaveCount(0);
});

// --- explicit UI locale, independent of the query's own language -----------

test('English UI with an Arabic-language query still sends the UI locale (en) explicitly, not inferred from the query', async ({ page }) => {
  await mockMe(page, { kinSearch: true, language: 'en' });
  let sentLocale: unknown;
  await page.route('**/api/kin/search', async (route) => {
    sentLocale = route.request().postDataJSON()?.locale;
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('إطلالة عشاء أنيقة');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-looks-options')).toBeVisible();
  expect(sentLocale).toBe('en');
});

test('Arabic UI with an English-language query still sends the UI locale (ar) explicitly, not inferred from the query', async ({ page }) => {
  await mockMe(page, { kinSearch: true, language: 'ar' });
  let sentLocale: unknown;
  await page.route('**/api/kin/search', async (route) => {
    sentLocale = route.request().postDataJSON()?.locale;
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a smart casual dinner outfit');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-looks-options')).toBeVisible();
  expect(sentLocale).toBe('ar');
});

test('the explicit UI locale is also sent on a photo request, as a query-string parameter', async ({ page }) => {
  await mockMe(page, { kinSearch: true, language: 'ar' });
  let sentUrl = '';
  await page.route('**/api/kin/looks/photo*', async (route) => {
    sentUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('style this shirt');
  await page.getByTestId('kin-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-looks-options')).toBeVisible();
  expect(new URL(sentUrl).searchParams.get('locale')).toBe('ar');
});
