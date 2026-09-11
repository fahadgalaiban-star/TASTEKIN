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

async function expectMobileControlAboveNavigation(page: Page, testId: string) {
  const control = page.getByTestId(testId);
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  const layout = await page.evaluate((id) => {
    const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const navigation = document.querySelector<HTMLElement>('[data-testid="primary-navigation"]');
    if (!element || !navigation) throw new Error(`Missing mobile layout element: ${id}`);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      elementBottom: element.getBoundingClientRect().bottom,
      navigationTop: navigation.getBoundingClientRect().top,
    };
  }, testId);
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(layout.elementBottom).toBeLessThanOrEqual(layout.navigationTop);
}

test('the bottom nav opens a real KIN page when the flag is on', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByRole('heading', { name: 'Style it your way.' })).toBeVisible();
  await expect(page.getByText('Start with one piece. Make it feel like you.')).toBeVisible();
  await expect(page.getByTestId('kin-styling-summary')).toBeVisible();
  await expect(page.getByTestId('kin-take-photo')).toContainText('Take a photo');
  await expect(page.getByTestId('kin-query')).toHaveAttribute('placeholder', 'Or describe what you want to style…');
  await expect(page.getByTestId('kin-occasion-everyday')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kin-submit')).toHaveText('Create my looks');
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

test('Looks mode: More preferences shows location/budget/size, occasion is outside, not destination/dates', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  let sentBody: Record<string, unknown> | undefined;
  await page.route('**/api/kin/search', async (route) => {
    sentBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', answer: '', citations: [], options: [{ label: 'signature', reasoning: '', ownedItems: [], missingItems: [] }], results: [] }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-occasion')).toBeVisible();
  await expect(page.getByTestId('kin-location')).toBeHidden();
  await page.getByTestId('kin-occasion-dinner').click();
  await page.getByTestId('kin-more-preferences').click();
  await expect(page.getByTestId('kin-location')).toBeVisible();
  await expect(page.getByTestId('kin-budget')).toBeVisible();
  await expect(page.getByTestId('kin-size')).toBeVisible();
  await expect(page.getByTestId('kin-destination')).toHaveCount(0);
  await expect(page.getByTestId('kin-start-date')).toHaveCount(0);
  await page.getByTestId('kin-query').fill('style a dinner piece');
  await page.getByTestId('kin-location').fill('Kuwait');
  await page.getByTestId('kin-budget').fill('180');
  await page.getByTestId('kin-currency').fill('kwd');
  await page.getByTestId('kin-size').fill('M');
  await page.getByTestId('kin-submit').click();
  await expect.poll(() => sentBody?.occasion).toBe('Dinner');
  expect(sentBody).toMatchObject({ location: 'Kuwait', budget: 180, currency: 'KWD', size: 'M' });
});

test('the approved Style input fits 390×844 without horizontal overflow and its CTA clears the bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMe(page, { kinSearch: true, myThings: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByRole('heading', { name: 'Style it your way.' })).toBeVisible();
  await expect(page.getByTestId('kin-open-my-things')).toBeVisible();
  await page.getByTestId('kin-photo-input').focus();
  await expect(page.getByTestId('kin-photo-input')).toBeFocused();
  await expectMobileControlAboveNavigation(page, 'kin-submit');
});

test('Back on Travel step 1 closes the guided flow and returns to active Looks', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await expect(page.getByTestId('kin-travel-step')).toHaveAttribute('data-step', '1');

  await page.getByTestId('kin-travel-back').click();

  await expect(page.getByTestId('kin-travel-step')).toHaveCount(0);
  await expect(page.getByTestId('kin-mode-looks')).toBeVisible();
  await expect(page.getByTestId('kin-mode-looks')).toHaveClass(/selected/);
  await expect(page.getByRole('heading', { name: 'Style it your way.' })).toBeVisible();
});

test('Travel is a dedicated two-step flow that submits exact dates and interests with no clothing payload', async ({ page }) => {
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
  await page.getByTestId('kin-start-date').fill('2026-10-03');
  await page.getByTestId('kin-end-date').fill('2026-10-09');
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
  await page.getByTestId('kin-interest-sport').click();
  await page.getByTestId('kin-sport-pilates').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect.poll(() => sentBody?.destination).toBe('Madrid');
  expect(sentBody?.startDate).toBe('2026-10-03');
  expect(sentBody?.endDate).toBe('2026-10-09');
  expect(sentBody?.interests).toEqual(['museums', 'pilates']);
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

test('compact Travel cards expose distinct Maps names, send server identities for Swap and Add to trip, and render successful replacements', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  const mapsUrl = 'https://maps.google.com/?cid=stable-place-1';
  const secondMapsUrl = 'https://www.google.com/maps/place/Second+Gallery';
  let swapBody: Record<string, unknown> | undefined;
  let tripBody: Record<string, unknown> | undefined;
  let tripItemBody: Record<string, unknown> | undefined;
  let failedTripItemBody: Record<string, unknown> | undefined;
  let tripItemCalls = 0;
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
            }, {
              placeId: 'stable-place-gallery',
              name: 'Second Gallery',
              formattedAddress: null,
              lat: 51.52,
              lng: -0.12,
              rating: 4.6,
              websiteUrl: null,
              mapsUrl: secondMapsUrl,
              photoUrl: null,
              photoAttribution: null,
              slot: null,
              activityInterest: 'museums',
              openingHours: null,
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
  await page.route('**/api/kin/trips', async (route) => {
    tripBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'trip-server-1' }) });
  });
  await page.route('**/api/kin/trips/trip-server-1/items', async (route) => {
    tripItemCalls += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.placeId === 'stable-place-gallery') {
      failedTripItemBody = body;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Could not add this place' }) });
      return;
    }
    tripItemBody = body;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'trip-item-1' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill('London');
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-interest-cafes').click();
  await page.getByTestId('kin-travel-submit').click();
  const place = page.getByTestId('kin-travel-place').first();
  await expect(place).toBeVisible();
  await expect(place).toContainText('Museums');
  await expect(place.getByRole('link', { name: 'Open A very long place name that remains constrained inside its compact card in Google Maps' })).toHaveAttribute('href', mapsUrl);
  await expect(page.getByRole('link', { name: 'Open Second Gallery in Google Maps' })).toHaveAttribute('href', secondMapsUrl);
  await expect(place).toContainText('Google contributor');
  const swap = place.getByTestId('kin-swap-place');
  const add = place.getByTestId('kin-add-to-trip');
  const maps = place.getByRole('link', { name: 'Open A very long place name that remains constrained inside its compact card in Google Maps' });
  for (const control of [swap, add, maps]) {
    const box = await control.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await add.click();
  await expect(add).toBeDisabled();
  expect(tripItemCalls).toBe(1);
  await expect(add).toHaveText('Added to trip');
  expect(tripBody).toEqual({ destination: 'London' });
  expect(tripItemBody).toEqual({
    dayIndex: 0,
    placeId: 'stable-place-1',
    name: 'A very long place name that remains constrained inside its compact card',
    formattedAddress: 'A full address that should not render',
    lat: 51.5,
    lng: -0.1,
  });
  const failedAdd = page.getByTestId('kin-travel-place').nth(1).getByTestId('kin-add-to-trip');
  const dialogPromise = page.waitForEvent('dialog');
  await failedAdd.click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('Could not add this place');
  await dialog.accept();
  expect(failedTripItemBody?.placeId).toBe('stable-place-gallery');
  await expect(failedAdd).toBeEnabled();
  await expect(failedAdd).toHaveText('Add to trip');
  await swap.click();
  await expect.poll(() => swapBody?.activityInterest).toBe('museums');
  expect(swapBody?.query).toBeUndefined();
  await expect(page.getByRole('main')).toContainText('Replacement Museum');
  await expect(page.getByText('This long narrative should not be shown')).toHaveCount(0);
  await expect(page.getByText('A full address that should not render')).toHaveCount(0);
  await expect(page.getByText('08:00–18:00')).toHaveCount(0);
  await expect(page.getByText(/10 min drive/)).toHaveCount(0);
});

test('both English Travel steps remain reachable above the bottom navigation at 390×844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMe(page, { kinSearch: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await expectMobileControlAboveNavigation(page, 'kin-end-date');
  await expectMobileControlAboveNavigation(page, 'kin-travel-next');
  await page.getByTestId('kin-destination').fill('Lisbon');
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-interest-sport').click();
  await expectMobileControlAboveNavigation(page, 'kin-sport-walking_places');
  await page.getByTestId('kin-sport-walking_places').click();
  await expect(page.getByTestId('kin-sport-walking_places')).toHaveAttribute('aria-pressed', 'true');
  await expectMobileControlAboveNavigation(page, 'kin-travel-submit');
});

test('Arabic Travel labels, Maps names, Back navigation, and both 390×844 steps are RTL-safe and reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMe(page, { kinSearch: true, language: 'ar' });
  await page.route('**/api/kin/travel/plan', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        plan: {
          destination: 'دبي',
          narrative: '',
          citations: [],
          days: [{
            dayIndex: 0,
            date: null,
            routes: [],
            places: [
              { placeId: 'dubai-1', name: 'متحف المستقبل', formattedAddress: null, lat: null, lng: null, rating: null, websiteUrl: null, mapsUrl: 'https://maps.google.com/?cid=dubai-1', photoUrl: null, photoAttribution: null, slot: null, activityInterest: 'museums', openingHours: null },
              { placeId: 'dubai-2', name: 'حديقة زعبيل', formattedAddress: null, lat: null, lng: null, rating: null, websiteUrl: null, mapsUrl: 'https://www.google.com/maps/place/Zabeel+Park', photoUrl: null, photoAttribution: null, slot: null, activityInterest: 'parks', openingHours: null },
            ],
          }],
        },
      }),
    });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('1 من 2')).toBeVisible();
  await expect(page.getByText('الوجهة', { exact: true })).toBeVisible();
  await expect(page.getByText('البداية (اختياري)', { exact: true })).toBeVisible();
  await expect(page.getByText('النهاية (اختياري)', { exact: true })).toBeVisible();
  await expect(page.getByTestId('kin-travel-next')).toHaveText('التالي');
  await expect(page.getByTestId('kin-travel-back')).toHaveText('رجوع');
  await expectMobileControlAboveNavigation(page, 'kin-end-date');
  await expectMobileControlAboveNavigation(page, 'kin-travel-next');
  await page.getByTestId('kin-destination').fill('دبي');
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByText('2 من 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'اختر اهتماماتك' })).toBeVisible();
  await expect(page.getByTestId('kin-travel-back')).toHaveText('رجوع');
  await expect(page.getByTestId('kin-interest-sport')).toContainText('رياضة');
  await page.getByTestId('kin-interest-sport').click();
  await expect(page.getByTestId('kin-sport-gyms')).toHaveText('نوادٍ رياضية');
  await expect(page.getByTestId('kin-sport-pilates')).toHaveText('بيلاتس');
  await expect(page.getByTestId('kin-sport-walking_places')).toHaveText('أماكن للمشي');
  await expectMobileControlAboveNavigation(page, 'kin-sport-walking_places');
  await page.getByTestId('kin-sport-walking_places').click();
  await expect(page.getByTestId('kin-sport-walking_places')).toHaveAttribute('aria-pressed', 'true');
  await expectMobileControlAboveNavigation(page, 'kin-travel-submit');
  await page.getByTestId('kin-travel-back').click();
  await expect(page.getByText('1 من 2')).toBeVisible();
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect(page.getByRole('link', { name: 'افتح متحف المستقبل في خرائط Google' })).toHaveText('خرائط');
  await expect(page.getByRole('link', { name: 'افتح حديقة زعبيل في خرائط Google' })).toHaveText('خرائط');
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

test('loading state shows while the request is in flight, then opens the concise results screen without long narrative or shopping links', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        answer: 'A warm, editorial answer grounded in live search.',
        citations: [{ title: 'Example Boutique', url: 'https://example.com/item-1' }],
        results: [{ title: 'Tailored shirt', source: 'example.com', url: 'https://example.com/item-1', imageUrl: null }],
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
  await expect(page.getByRole('heading', { name: 'Made for your taste.' })).toBeVisible();
  await expect(page.getByTestId('kin-result-card')).toContainText('Tailored shirt');
  await expect(page.getByText('A warm, editorial answer grounded in live search.')).toHaveCount(0);
  await expect(page.locator('a[href="https://example.com/item-1"]')).toHaveCount(0);
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

test('external result cards render title and verified source, never a price or shopping link, and enlarge on tap', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        answer: 'Here is one option.',
        citations: [],
        options: [{ label: 'signature', reasoning: 'A tailored look.', ownedItems: [], missingItems: [] }],
        results: [
          { title: 'Wool Coat', source: 'example.com', url: 'https://example.com/coat', price: 240, currency: 'USD', imageUrl: null },
        ],
      }),
    });
  });
  await page.route('**/api/kin/saved', async (route) => { await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a warm coat');
  await page.getByTestId('kin-submit').click();
  const card = page.getByTestId('kin-result-card');
  await expect(card).toContainText('Wool Coat');
  await expect(card).toContainText('example.com');
  await expect(card).not.toContainText('USD 240');
  await expect(card.locator('a')).toHaveCount(0);
  await expect(card).not.toHaveAttribute('href', /.*/);
  await expect(card.locator('img')).toHaveAttribute('src', '/kin-placeholder.svg');
  // No per-product save control exists — KIN never invents a per-item
  // save endpoint, so a result card is never given a misleading save
  // affordance of its own. Only "Save Look" (checked below) is real.
  await expect(page.getByTestId('kin-result-save')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /save/i })).toHaveCount(0);

  await card.click();
  await expect(page.getByTestId('kin-lightbox')).toBeVisible();
  await expect(page.getByTestId('kin-lightbox')).toContainText('Wool Coat');
  await expect(page.getByTestId('kin-lightbox')).not.toContainText('USD 240');
  await expect(page.locator('a[href="https://example.com/coat"]')).toHaveCount(0);
  await page.getByLabel('Close', { exact: true }).click();
  await expect(page.getByTestId('kin-lightbox')).toHaveCount(0);

  // The whole-look Save Look control is the only save action, and it
  // reflects its own saved state once used.
  const saveButton = page.getByTestId('kin-save');
  await expect(saveButton).toHaveText('Save Look');
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(saveButton).toHaveText('Saved');
  await expect(saveButton).toBeDisabled();
});

test('Save Look blocks rapid duplicate requests and remains retryable after failure', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        answer: '',
        citations: [],
        options: [{ label: 'signature', reasoning: 'A tailored look.', ownedItems: [], missingItems: [] }],
        results: [],
      }),
    });
  });
  let saveRequests = 0;
  await page.route('**/api/kin/saved', async (route) => {
    saveRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: saveRequests === 1 ? 500 : 201,
      contentType: 'application/json',
      body: saveRequests === 1 ? JSON.stringify({ error: 'Save failed' }) : '{}',
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a tailored evening look');
  await page.getByTestId('kin-submit').click();

  const saveButton = page.getByTestId('kin-save');
  await saveButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
    button.click();
  });
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveText('Saving…');
  await expect(saveButton).toBeEnabled();
  await expect(saveButton).toHaveText('Save Look');
  expect(saveRequests).toBe(1);

  await saveButton.click();
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveText('Saved');
  expect(saveRequests).toBe(2);
});

test('the result lightbox traps focus, closes accessibly, restores the exact trigger, and shows the selected result', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: looksOkBody({ results: [
        { title: 'First Coat', source: 'first.example', url: 'https://first.example/coat', price: null, currency: null, imageUrl: 'https://first.example/coat.jpg' },
        { title: 'Second Jacket', source: 'second.example', url: 'https://second.example/jacket', price: null, currency: null, imageUrl: 'https://second.example/jacket.jpg' },
      ] }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('two outerwear options');
  await page.getByTestId('kin-submit').click();

  const cards = page.getByTestId('kin-result-card');
  const firstCard = cards.nth(0);
  await firstCard.click();
  const closeButton = page.getByRole('button', { name: 'Close', exact: true });
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('kin-lightbox')).toHaveCount(0);
  await expect(firstCard).toBeFocused();

  const secondCard = cards.nth(1);
  await secondCard.click();
  const lightbox = page.getByTestId('kin-lightbox');
  await expect(lightbox).toContainText('Second Jacket');
  await expect(lightbox.locator('img')).toHaveAttribute('src', 'https://second.example/jacket.jpg');
  await closeButton.click();
  await expect(lightbox).toHaveCount(0);
  await expect(secondCard).toBeFocused();
});

test('the approved My Things entry opens the private item picker when the feature is enabled', async ({ page }) => {
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
  await expect(page.getByTestId('kin-open-my-things')).toBeVisible();
  await page.getByTestId('kin-open-my-things').click();
  await expect(page.getByTestId('my-things-style-with-kin')).toBeVisible();
});

test('the My Things entry is absent when my_things is disabled', async ({ page }) => {
  await mockMe(page, { kinSearch: true, myThings: false });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-open-my-things')).toHaveCount(0);
  await expect(page.getByTestId('kin-mode-my-things')).toHaveCount(0);
});

test('Arabic UI strings render for KIN', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMe(page, { kinSearch: true, language: 'ar' });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        answer: '',
        citations: [],
        options: [{ label: 'signature', reasoning: '', ownedItems: [], missingItems: [] }],
        results: [{ title: 'قميص كتان', source: 'example.com', url: 'https://example.com/shirt', imageUrl: null }],
      }),
    });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByRole('heading', { name: 'نسّقها بطريقتك.' })).toBeVisible();
  await expect(page.getByText('ابدأ بقطعة واحدة، واجعلها تعبّر عنك.')).toBeVisible();
  await expect(page.getByTestId('kin-mode-looks')).toHaveText('نسّق لي');
  await expect(page.getByTestId('kin-mode-travel')).toHaveText('السفر');
  await expect(page.getByTestId('kin-submit')).toHaveText('أنشئ إطلالاتي');
  await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
  await expectMobileControlAboveNavigation(page, 'kin-submit');
  await page.getByTestId('kin-query').fill('نسّق قميصاً كتانياً');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByRole('heading', { name: 'مختارة لذوقك.' })).toBeVisible();
  await expect(page.getByTestId('kin-result-card')).toContainText('قميص كتان');
  await expect(page.getByTestId('kin-new-suggestions')).toHaveText('عرض خيارات أكثر');
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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await page.getByTestId('my-things-style-with-kin').click();
  await page.getByTestId('my-things-style-item').getByRole('button').click();
  await page.getByTestId('my-things-style-continue').click();
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-look-reference').getByRole('img')).toHaveAttribute('src', '/api/closet-items/item-42/image');
  const pieceCard = page.getByTestId('kin-piece-card');
  await expect(pieceCard).toBeVisible();
  await expect(pieceCard).toContainText('Your piece');
  await pieceCard.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(page.getByTestId('my-things-style-continue')).toBeVisible();
});

test('choosing a photo replaces a preselected My Things piece everywhere before submission', async ({ page }) => {
  await mockMe(page, { kinSearch: true, myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'item-42', itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', createdAt: new Date().toISOString() }] }),
      });
    }
  });
  let photoCalls = 0;
  let searchCalls = 0;
  await page.route('**/api/kin/looks/photo*', async (route) => {
    photoCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() });
  });
  await page.route('**/api/kin/search', async (route) => {
    searchCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await page.getByTestId('my-things-style-with-kin').click();
  await page.getByTestId('my-things-style-item').getByRole('button').click();
  await page.getByTestId('my-things-style-continue').click();
  await expect(page.getByTestId('kin-styling-summary').locator('img')).toHaveAttribute('src', '/api/closet-items/item-42/image');

  await page.getByTestId('kin-photo-input').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('replacement-photo') });
  await expect(page.getByTestId('kin-styling-summary').getByRole('img', { name: 'Selected styling piece' })).toHaveAttribute('src', /^blob:/);
  await expect(page.getByTestId('kin-styling-summary').locator('img[src="/api/closet-items/item-42/image"]')).toHaveCount(0);
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-look-reference').getByRole('img')).toHaveAttribute('src', /^blob:/);
  expect(photoCalls).toBe(1);
  expect(searchCalls).toBe(0);
});

test('multiple preselected My Things items render one compact count with an authorized thumbnail and no private key', async ({ page }) => {
  await mockMe(page, { kinSearch: true, myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [
          { id: 'shirt-1', itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', ownershipStatus: 'owned', imagePath: '/objects/private/member/shirt.jpg', createdAt: new Date().toISOString() },
          { id: 'shoes-2', itemType: 'sneakers', primaryColor: 'white', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', ownershipStatus: 'owned', imagePath: '/objects/private/member/shoes.jpg', createdAt: new Date().toISOString() },
        ] }),
      });
    }
  });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await page.getByTestId('my-things-style-with-kin').click();
  const styleItems = page.getByTestId('my-things-style-item');
  await styleItems.nth(0).getByRole('button').click();
  await styleItems.nth(1).getByRole('button').click();
  await page.getByTestId('my-things-style-continue').click();
  await page.getByTestId('kin-query').fill('style both pieces');
  await page.getByTestId('kin-submit').click();

  const pieceCard = page.getByTestId('kin-piece-card');
  await expect(pieceCard).toContainText('Styled with 2 items');
  await expect(pieceCard.locator('img')).toHaveAttribute('src', '/api/closet-items/shirt-1/image');
  await expect(pieceCard.locator('img')).not.toHaveAttribute('src', /\/objects\/private\//);
  await expect(page.locator('body')).not.toContainText('/objects/private/member/');
});

test('Style results fit 390×844 and the final result remains reachable above navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: looksOkBody({ results: [
        { title: 'First Coat', source: 'first.example', url: 'https://first.example/coat', price: null, currency: null, imageUrl: null },
        { title: 'Second Jacket', source: 'second.example', url: 'https://second.example/jacket', price: null, currency: null, imageUrl: null },
      ] }),
    });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('two compact outerwear options');
  await page.getByTestId('kin-submit').click();

  const finalCard = page.getByTestId('kin-result-card').last();
  await finalCard.scrollIntoViewIfNeeded();
  await expect(finalCard).toBeVisible();
  const layout = await page.evaluate(() => {
    const cards = document.querySelectorAll<HTMLElement>('[data-testid="kin-result-card"]');
    const finalResult = cards[cards.length - 1];
    const navigation = document.querySelector<HTMLElement>('[data-testid="primary-navigation"]');
    if (!finalResult || !navigation) throw new Error('Missing Style result layout elements');
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      finalResultBottom: finalResult.getBoundingClientRect().bottom,
      navigationTop: navigation.getBoundingClientRect().top,
    };
  });
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(layout.finalResultBottom).toBeLessThanOrEqual(layout.navigationTop);
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
  await expect(page.getByTestId('kin-piece-card')).toHaveCount(0);
  await expect(page.getByTestId('kin-result-card').nth(0).locator('img')).toHaveAttribute('src', 'https://a.example.com/1.jpg');
  await expect(page.getByTestId('kin-result-card').nth(1).locator('img')).toHaveAttribute('src', 'https://b.example.com/2.jpg');
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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await page.getByTestId('my-things-style-with-kin').click();
  await page.getByTestId('my-things-style-item').getByRole('button').click();
  await page.getByTestId('my-things-style-continue').click();
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
  await expect(page.getByTestId('kin-result-guidance')).toContainText('A tailored navy look for tonight, worn with minimal accessories.');
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
  await expect(page.getByTestId('kin-result-directions')).toContainText('Signature');
  await expect(page.getByText('A tailored navy look for tonight.')).toHaveCount(0);
});

test('the approved Show more options button regenerates the whole response', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a dinner outfit');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-looks-options')).toBeVisible();
  await expect(page.getByTestId('kin-new-suggestions')).toHaveText('Show more options');
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
