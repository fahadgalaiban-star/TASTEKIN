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
  await expect(page.getByRole('heading', { name: 'Style a Piece' })).toBeVisible();
  await expect(page.getByText('Start with something you own or something you found.')).toBeVisible();
  // No piece selected yet — the empty preview is the "Add a Piece" trigger,
  // not the populated kin-styling-summary state.
  await expect(page.getByTestId('kin-add-piece')).toBeVisible();
  await page.getByTestId('kin-add-piece').click();
  await expect(page.getByTestId('kin-take-photo')).toContainText('Take a Photo');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('kin-query')).toHaveAttribute('placeholder', 'Black trousers to match my cream shirt');
  await expect(page.getByTestId('kin-occasion-everyday')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kin-submit')).toHaveText('Create My Look');
  await expect(page.getByTestId('kin-mode-looks')).toBeVisible();
  await expect(page.getByTestId('kin-mode-looks')).toHaveCSS('color', 'rgb(255, 255, 255)');
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

test('Looks mode: Add budget reveals budget/currency fields, occasion is outside, not destination/dates', async ({ page }) => {
  // The old "More preferences" <details> (Location, Budget+Currency, Size)
  // was replaced by a standalone "Add budget" toggle that reveals only
  // budget+currency; Location and Size were removed from the UI entirely
  // (their state/body-serialization in submit() is unchanged, but with no
  // control to set them they simply stay empty and are omitted — that half
  // of the original assertion is no longer exercisable from the UI, so it
  // is dropped rather than faked).
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
  await expect(page.getByTestId('kin-preferences')).toHaveCount(0);
  await expect(page.getByTestId('kin-location')).toHaveCount(0);
  await expect(page.getByTestId('kin-size')).toHaveCount(0);
  await page.getByTestId('kin-occasion-dinner').click();
  await page.getByTestId('kin-add-budget').click();
  await expect(page.getByTestId('kin-preferences')).toBeVisible();
  await expect(page.getByTestId('kin-budget')).toBeVisible();
  await expect(page.getByTestId('kin-currency')).toBeVisible();
  await expect(page.getByTestId('kin-destination')).toHaveCount(0);
  await expect(page.getByTestId('kin-start-date')).toHaveCount(0);
  await page.getByTestId('kin-query').fill('style a dinner piece');
  await page.getByTestId('kin-budget').fill('180');
  await page.getByTestId('kin-currency').fill('kwd');
  await page.getByTestId('kin-submit').click();
  await expect.poll(() => sentBody?.occasion).toBe('Dinner');
  expect(sentBody).toMatchObject({ budget: 180, currency: 'KWD' });
  expect(sentBody?.location).toBeUndefined();
  expect(sentBody?.size).toBeUndefined();
});

test('the approved Style input fits 390×844 without horizontal overflow and its CTA clears the bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMe(page, { kinSearch: true, myThings: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByRole('heading', { name: 'Style a Piece' })).toBeVisible();
  await page.getByTestId('kin-add-piece').click();
  await expect(page.getByTestId('kin-open-my-things')).toBeVisible();
  await page.getByTestId('kin-photo-input').focus();
  await expect(page.getByTestId('kin-photo-input')).toBeFocused();
  await page.keyboard.press('Escape');
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
  await expect(page.getByRole('heading', { name: 'Style a Piece' })).toBeVisible();
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
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  const card = place.locator('.kin-timeline-card');
  const thumb = place.locator('.kin-timeline-thumb');
  const body = place.locator('.kin-timeline-body');
  const name = place.locator('.kin-timeline-name');
  const credit = place.locator('.kin-photo-credit');
  const swap = place.getByTestId('kin-swap-place');
  const [placeBox, cardBox, thumbBox, bodyBox, nameBox, creditBox, swapBox] = await Promise.all([
    place.boundingBox(),
    card.boundingBox(),
    thumb.boundingBox(),
    body.boundingBox(),
    name.boundingBox(),
    credit.boundingBox(),
    swap.boundingBox(),
  ]);
  expect(placeBox?.width).toBeGreaterThan(300);
  expect(cardBox?.width).toBeGreaterThan(280);
  // The venue image is now a noticeably larger, premium-feeling ~38-42% of
  // the card's width (was a small fixed 72px square) — never so large it
  // crowds out the name/actions column entirely.
  expect(thumbBox && cardBox ? thumbBox.width / cardBox.width : 0).toBeGreaterThan(0.36);
  expect(thumbBox && cardBox ? thumbBox.width / cardBox.width : 1).toBeLessThan(0.46);
  expect(bodyBox?.width).toBeGreaterThan(90);
  expect(nameBox?.width).toBeGreaterThan(60);
  expect(creditBox?.width).toBeGreaterThan(60);
  // The long name must wrap within its own column and never sit under the
  // absolutely positioned SWAP control on the trailing edge of the card.
  expect(nameBox && swapBox ? nameBox.x + nameBox.width : Infinity).toBeLessThanOrEqual(swapBox?.x ?? 0);
  expect(creditBox && swapBox ? creditBox.x + creditBox.width : Infinity).toBeLessThanOrEqual(swapBox?.x ?? 0);
  const add = place.getByTestId('kin-add-to-trip');
  const maps = place.getByRole('link', { name: 'Open A very long place name that remains constrained inside its compact card in Google Maps' });
  await expect(maps).toHaveText('Directions');
  for (const control of [swap, add, maps]) {
    const box = await control.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await add.click();
  await expect(add).toBeDisabled();
  expect(tripItemCalls).toBe(1);
  await expect(add).toHaveText('Saved');
  await expect(page.getByTestId('kin-travel-action-notice')).toHaveText('Saved to your trip.');
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
  await expect(failedAdd).toHaveText('Save to trip');
  await swap.click();
  await expect(swap).toBeDisabled();
  await expect(swap).toHaveText('SWAPPING…');
  await expect.poll(() => swapBody?.activityInterest).toBe('museums');
  expect(swapBody?.query).toBeUndefined();
  await expect(page.getByRole('main')).toContainText('Replacement Museum');
  await expect(page.getByTestId('kin-travel-action-notice')).toHaveText('Place replaced.');
  await expect(swap).toBeEnabled();
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
              { placeId: 'dubai-1', name: 'متحف المستقبل', formattedAddress: null, lat: 25.217, lng: 55.281, rating: null, websiteUrl: null, mapsUrl: 'https://maps.google.com/?cid=dubai-1', photoUrl: null, photoAttribution: null, slot: null, activityInterest: 'museums', openingHours: null },
              { placeId: 'dubai-2', name: 'حديقة زعبيل', formattedAddress: null, lat: 25.230, lng: 55.304, rating: null, websiteUrl: null, mapsUrl: 'https://www.google.com/maps/place/Zabeel+Park', photoUrl: null, photoAttribution: null, slot: null, activityInterest: 'parks', openingHours: null },
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
  await expect(page.getByRole('link', { name: 'افتح متحف المستقبل في خرائط Google' })).toHaveText('الاتجاهات');
  await expect(page.getByRole('link', { name: 'افتح حديقة زعبيل في خرائط Google' })).toHaveText('الاتجاهات');
  // Non-Latin destination is never touched by the display-casing cleanup.
  await expect(page.locator('.kin-headline')).toHaveText('دبي، مصمّمة على ذوقك.');
  await expect(page.locator('[data-testid="kin-hero-tag"]')).toHaveText('دبي');

  // Route tab is RTL-safe: an ordered stop list plus one combined
  // Google Maps action, all in Arabic — no coordinate-plot canvas.
  await page.getByTestId('kin-plan-route-toggle').getByRole('button', { name: 'المسار' }).click();
  await expect(page.getByTestId('kin-travel-route')).toBeVisible();
  await expect(page.getByTestId('kin-route-item')).toHaveCount(2);
  await expect(page.getByTestId('kin-route-item').first().getByRole('link', { name: 'افتح متحف المستقبل في خرائط Google' })).toHaveText('الاتجاهات');
  const openDay = page.getByTestId('kin-route-open-day');
  await expect(openDay).toHaveText('فتح يوم الرحلة في خرائط Google');
  await expect(openDay).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=25\.217%2C55\.281&destination=25\.23%2C55\.304&travelmode=driving$/);
});

async function mockTwoDayPlan(page: Page, destination = 'paris') {
  await page.route('**/api/kin/travel/plan', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        plan: {
          destination,
          narrative: '',
          citations: [],
          days: [
            {
              dayIndex: 0,
              date: '2026-09-22',
              places: [
                { placeId: 'p1', name: 'Le Marais Bakery', formattedAddress: null, lat: 48.857, lng: 2.360, rating: 4.5, websiteUrl: null, mapsUrl: 'https://maps.google.com/?cid=1', photoUrl: null, photoAttribution: null, slot: 'BREAKFAST', activityInterest: null, openingHours: null },
                { placeId: 'p2', name: 'Mystery Spot With No Coordinates', formattedAddress: null, lat: null, lng: null, rating: null, websiteUrl: null, mapsUrl: null, photoUrl: null, photoAttribution: null, slot: null, activityInterest: 'museums', openingHours: null },
              ],
              routes: [],
            },
            {
              dayIndex: 1,
              date: '2026-09-23',
              places: [
                { placeId: 'p3', name: 'Louvre Museum', formattedAddress: null, lat: 48.860, lng: 2.337, rating: 4.8, websiteUrl: null, mapsUrl: 'https://maps.google.com/?cid=3', photoUrl: 'https://picsum.photos/seed/louvre/400/500', photoAttribution: 'Google contributor', slot: null, activityInterest: 'museums', openingHours: null },
              ],
              routes: [],
            },
          ],
        },
      }),
    });
  });
}

async function submitTravelPlan(page: Page, destination = 'paris', interestTestId = 'kin-interest-cafes') {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill(destination);
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId(interestTestId).click();
  await page.getByTestId('kin-travel-submit').click();
  await expect(page.getByTestId('kin-screen')).toBeVisible();
}

test('destination display is capitalized for display only, and the hero updates per day with an accurate alt text, gradient fallback, and no stale content from the previous day', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await mockTwoDayPlan(page, 'paris');
  let sentDestination: string | undefined;
  await page.route('**/api/kin/travel/plan', async (route) => {
    sentDestination = route.request().postDataJSON().destination;
    await route.fallback();
  });
  await submitTravelPlan(page);

  // Display is cleaned up ("Paris"), but the raw value sent to the server for the search itself is untouched ("paris").
  expect(sentDestination).toBe('paris');
  await expect(page.locator('.kin-headline')).toHaveText('Paris, shaped around you.');

  // Day 1 has no place with a photo: gradient/mark fallback, tag names the destination.
  await expect(page.locator('.kin-hero img')).toHaveCount(0);
  await expect(page.getByTestId('kin-hero-tag')).toHaveText('Day 1 · Paris');

  // Day 2's only place has a photo: hero switches to it with an accurate alt text and no stale Day 1 content.
  await page.getByTestId('kin-day-tabs').getByRole('button', { name: 'Day 2' }).click();
  await expect(page.getByTestId('kin-hero-tag')).toHaveText('Day 2 · Paris');
  await expect(page.locator('.kin-hero img')).toHaveAttribute('alt', 'Photo of Louvre Museum');
  await expect(page.locator('.kin-hero img')).toHaveAttribute('src', 'https://picsum.photos/seed/louvre/400/500');

  // No layout shift: the hero keeps the same footprint whether or not it currently holds a photo.
  await page.getByTestId('kin-day-tabs').getByRole('button', { name: 'Day 1' }).click();
  const heroBox = await page.getByTestId('kin-travel-hero').boundingBox();
  await page.getByTestId('kin-day-tabs').getByRole('button', { name: 'Day 2' }).click();
  const heroBox2 = await page.getByTestId('kin-travel-hero').boundingBox();
  expect(heroBox2?.height).toBeCloseTo(heroBox?.height ?? 0, 0);
  expect(heroBox2?.width).toBeCloseTo(heroBox?.width ?? 0, 0);
});

test('a mixed-case Latin destination is title-cased for display without corrupting the sent value', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/travel/plan', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', plan: { destination: 'new york city', narrative: '', citations: [], days: [{ dayIndex: 0, date: null, places: [{ placeId: 'ny1', name: 'Central Park', formattedAddress: null, lat: 40.78, lng: -73.96, rating: null, websiteUrl: null, mapsUrl: null, photoUrl: null, photoAttribution: null, slot: null, activityInterest: 'parks', openingHours: null }], routes: [] }] } }),
    });
  });
  await submitTravelPlan(page, 'new york city');
  await expect(page.locator('.kin-headline')).toHaveText('New York City, shaped around you.');
  await expect(page.getByTestId('kin-hero-tag')).toHaveText('New York City');
});

test('the trip date range renders as a friendly localized range and is hidden entirely when no dates were provided', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await mockTwoDayPlan(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill('paris');
  await page.getByTestId('kin-start-date').fill('2026-09-22');
  await page.getByTestId('kin-end-date').fill('2026-09-29');
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-interest-cafes').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect(page.getByTestId('kin-travel-dates')).toHaveText('22–29 Sep 2026');

  // No dates at all: the whole line is absent, not shown blank.
  await page.getByTestId('kin-back').click();
  await page.getByTestId('kin-travel-back').click();
  await page.getByTestId('kin-start-date').fill('');
  await page.getByTestId('kin-end-date').fill('');
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect(page.getByTestId('kin-travel-dates')).toHaveCount(0);
});

test('the Route tab lists only the active day\'s stops in itinerary order, updates immediately on day switch, and never renders the old coordinate-plot canvas', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await mockTwoDayPlan(page);
  await submitTravelPlan(page);
  await page.getByTestId('kin-plan-route-toggle').getByRole('button', { name: 'Route' }).click();

  // Day 1: two stops, in order, each with its own category/name/Directions — including the one missing coordinates.
  await expect(page.getByTestId('kin-travel-route')).toBeVisible();
  await expect(page.getByTestId('kin-route-item')).toHaveCount(2);
  const day1First = page.getByTestId('kin-route-item').first();
  await expect(day1First.locator('.kin-route-index')).toHaveText('1');
  await expect(day1First.locator('.kin-route-category')).toHaveText('Breakfast');
  await expect(day1First.locator('.kin-route-name')).toHaveText('Le Marais Bakery');
  await expect(day1First.getByRole('link', { name: 'Open Le Marais Bakery in Google Maps' })).toHaveAttribute('href', 'https://maps.google.com/?cid=1');
  // No coordinate-plot canvas, pins, or connecting lines anywhere on this tab.
  await expect(page.locator('.kin-map, .kin-map-pin, [data-testid="kin-map-pin"]')).toHaveCount(0);
  // The single combined action opens a real maps.google.com URL, with the coordinate-having stop as origin and the name-only stop resolved by search.
  await expect(page.getByTestId('kin-route-open-day')).toHaveAttribute('href',
    `https://www.google.com/maps/dir/?api=1&origin=48.857%2C2.36&destination=${encodeURIComponent('Mystery Spot With No Coordinates')}&travelmode=driving`);

  // Switching days updates the Route list and its Google Maps URL immediately — no leftover day-1 content.
  await page.getByTestId('kin-day-tabs').getByRole('button', { name: 'Day 2' }).click();
  await expect(page.getByTestId('kin-route-item')).toHaveCount(1);
  await expect(page.getByTestId('kin-route-item').first().locator('.kin-route-name')).toHaveText('Louvre Museum');
  // A single-stop day opens a plain place search, not a meaningless one-point "directions".
  await expect(page.getByTestId('kin-route-open-day')).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=48.86%2C2.337');
});

test('a day with no usable location data at all still lists its stop by name, with a name-search Google Maps action', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/travel/plan', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', plan: { destination: 'paris', narrative: '', citations: [], days: [{ dayIndex: 0, date: null, places: [{ placeId: 'p1', name: 'Unlocated Place', formattedAddress: null, lat: null, lng: null, rating: null, websiteUrl: null, mapsUrl: null, photoUrl: null, photoAttribution: null, slot: null, activityInterest: 'museums', openingHours: null }], routes: [] }] } }),
    });
  });
  await submitTravelPlan(page);
  await page.getByTestId('kin-plan-route-toggle').getByRole('button', { name: 'Route' }).click();
  await expect(page.getByTestId('kin-route-item')).toHaveCount(1);
  await expect(page.getByTestId('kin-route-item').first().locator('.kin-route-name')).toHaveText('Unlocated Place');
  await expect(page.getByTestId('kin-route-open-day')).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Unlocated%20Place');
});

test('Save to trip, Swap, and the Route tab render correctly at a 320px viewport with no horizontal overflow or control overlap', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockMe(page, { kinSearch: true });
  await mockTwoDayPlan(page);
  await page.route('**/api/kin/trips', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'trip-320' }) });
  });
  await page.route('**/api/kin/trips/trip-320/items', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'item-320' }) });
  });
  await submitTravelPlan(page);

  expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
  const place = page.getByTestId('kin-travel-place').first();
  const [nameBox, swapBox] = await Promise.all([
    place.locator('.kin-timeline-name').boundingBox(),
    place.getByTestId('kin-swap-place').boundingBox(),
  ]);
  expect(nameBox && swapBox ? nameBox.x + nameBox.width : Infinity).toBeLessThanOrEqual(swapBox?.x ?? 0);

  await place.getByTestId('kin-add-to-trip').click();
  await expect(place.getByTestId('kin-add-to-trip')).toHaveText('Saved');

  await page.getByTestId('kin-plan-route-toggle').getByRole('button', { name: 'Route' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByTestId('kin-travel-route')).toBeVisible();
  await expect(page.getByTestId('kin-route-open-day')).toBeVisible();
});

// A fully Latin name and a mixed Arabic/Latin name must render in full,
// on both the Plan and Route tabs, inside an otherwise fully Arabic/RTL
// page — not reordered or clipped by inheriting the page's RTL direction.
// Role-based/toHaveText checks alone would pass even if the text were
// visually scrambled or clipped, since they read DOM text content
// regardless of layout — these also compare scrollWidth to clientWidth,
// which catches genuine visual overflow.
test('a Latin venue name and a mixed Arabic/Latin venue name render in full, not reordered or clipped, inside the Arabic Travel UI at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMe(page, { kinSearch: true, language: 'ar' });
  await page.route('**/api/kin/travel/plan', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        plan: {
          destination: 'paris', narrative: '', citations: [],
          days: [{
            dayIndex: 0, date: null, routes: [],
            places: [
              { placeId: 'lat-1', name: 'Le Marais Bakery', formattedAddress: '12 Rue des Rosiers, Paris', lat: 48.857, lng: 2.360, rating: null, websiteUrl: null, mapsUrl: 'https://maps.google.com/?cid=lat-1', photoUrl: null, photoAttribution: null, slot: 'BREAKFAST', activityInterest: null, openingHours: null },
              { placeId: 'mix-1', name: 'Le Marais العليبان', formattedAddress: null, lat: 48.858, lng: 2.361, rating: null, websiteUrl: null, mapsUrl: 'https://maps.google.com/?cid=mix-1', photoUrl: null, photoAttribution: null, slot: null, activityInterest: 'museums', openingHours: null },
            ],
          }],
        },
      }),
    });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill('paris');
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-interest-cafes').click();
  await page.getByTestId('kin-travel-submit').click();

  const assertNoOverflow = async (locator: ReturnType<Page['locator']>) => {
    const box = await locator.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
  };

  // Destination isolation: "Paris" stays Latin-cased and legible inside the Arabic sentence and hero tag.
  await expect(page.locator('.kin-headline')).toHaveText('Paris، مصمّمة على ذوقك.');
  await expect(page.getByTestId('kin-hero-tag')).toHaveText('Paris');
  expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);

  // Plan tab: both venue names render in full, not clipped from the wrong end.
  const items = page.getByTestId('kin-travel-place');
  await expect(items.nth(0).locator('.kin-timeline-name')).toHaveText('Le Marais Bakery');
  await expect(items.nth(1).locator('.kin-timeline-name')).toHaveText('Le Marais العليبان');
  await assertNoOverflow(items.nth(0).locator('.kin-timeline-name'));
  await assertNoOverflow(items.nth(1).locator('.kin-timeline-name'));

  // Route tab: same two names in full, plus the area/address, none overflowing.
  await page.getByTestId('kin-plan-route-toggle').getByRole('button', { name: 'المسار' }).click();
  const routeItems = page.getByTestId('kin-route-item');
  await expect(routeItems.nth(0).locator('.kin-route-name')).toHaveText('Le Marais Bakery');
  await expect(routeItems.nth(0).locator('.kin-route-address')).toHaveText('12 Rue des Rosiers, Paris');
  await expect(routeItems.nth(1).locator('.kin-route-name')).toHaveText('Le Marais العليبان');
  await assertNoOverflow(routeItems.nth(0).locator('.kin-route-name'));
  await assertNoOverflow(routeItems.nth(0).locator('.kin-route-address'));
  await assertNoOverflow(routeItems.nth(1).locator('.kin-route-name'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
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

test('a 400 validation response is shown as a request problem, not a temporary KIN outage', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.route('**/api/kin/search', async (route) => {
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'query is required' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('style this piece');
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-error')).toHaveText('Please check your styling details and try again.');
  await expect(page.getByText('KIN is temporarily unavailable. Please try again shortly.')).toHaveCount(0);
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
  let searchQuery: unknown;
  let savedQuery: unknown;
  await page.route('**/api/kin/search', async (route) => {
    searchQuery = route.request().postDataJSON()?.query;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        answer: 'Here is one option.',
        citations: [],
        options: [{ label: 'signature', reasoning: 'A tailored look.', ownedItems: [], missingItems: [] }],
        results: [
          { title: 'Longline Double-Breasted Wool Coat', source: 'example.com', url: 'https://example.com/coat', price: 240, currency: 'USD', imageUrl: null },
        ],
      }),
    });
  });
  await page.route('**/api/kin/saved', async (route) => {
    savedQuery = route.request().postDataJSON()?.query;
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-query').fill('a warm coat');
  await page.getByTestId('kin-submit').click();
  const card = page.getByTestId('kin-result-card');
  await expect(card).toContainText('Longline Double-Breasted Wool Coat');
  await expect(card).toContainText('example.com');
  await expect(card).not.toContainText('USD 240');
  await expect(card.locator('a')).toHaveCount(0);
  await expect(card).not.toHaveAttribute('href', /.*/);
  await expect(card.locator('img')).toHaveAttribute('src', '/kin-placeholder.svg');
  await expect(card.locator('strong')).toHaveCSS('white-space', 'normal');
  await expect(card.locator('strong')).toHaveCSS('overflow-wrap', 'anywhere');
  // No per-product save control exists — KIN never invents a per-item
  // save endpoint, so a result card is never given a misleading save
  // affordance of its own. Only "Save Look" (checked below) is real.
  await expect(page.getByTestId('kin-result-save')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /save/i })).toHaveCount(0);

  await card.click();
  await expect(page.getByTestId('kin-lightbox')).toBeVisible();
  await expect(page.getByTestId('kin-lightbox')).toContainText('Longline Double-Breasted Wool Coat');
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
  expect(searchQuery).toBe('a warm coat');
  expect(savedQuery).toBe(searchQuery);
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

test('the approved My Things entry opens My Things, where a piece can be picked to style, when the feature is enabled', async ({ page }) => {
  // The old flow opened a dedicated multi-select item picker directly from
  // KIN. That picker is gone; "Choose from My Closet" now just navigates to
  // the regular My Things screen, where picking a piece happens through its
  // own per-card "Style This Piece" affordance (covered end-to-end in
  // my-things.spec.ts). This test verifies the entry point still reaches
  // My Things with the item visible and reachable.
  await mockMe(page, { kinSearch: true, myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'item-1', itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', ownershipStatus: 'owned', createdAt: new Date().toISOString() }] }),
      });
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-add-piece').click();
  await expect(page.getByTestId('kin-open-my-things')).toBeVisible();
  await page.getByTestId('kin-open-my-things').click();
  await expect(page.getByRole('heading', { name: 'My Closet' })).toBeVisible();
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await page.getByTestId('my-things-open').click();
  await expect(page.getByTestId('my-things-style-piece')).toBeVisible();
});

test('the My Things entry is absent when my_things is disabled', async ({ page }) => {
  await mockMe(page, { kinSearch: true, myThings: false });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-mode-my-things')).toHaveCount(0);
  await page.getByTestId('kin-add-piece').click();
  await expect(page.getByTestId('kin-take-photo')).toBeVisible();
  await expect(page.getByTestId('kin-open-my-things')).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'نسّق قطعة' })).toBeVisible();
  await expect(page.getByText('ابدأ بشيء تملكه أو شيء وجدته.')).toBeVisible();
  await expect(page.getByTestId('kin-mode-looks')).toHaveText('نسّق لي');
  await expect(page.getByTestId('kin-mode-travel')).toHaveText('السفر');
  await expect(page.getByTestId('kin-submit')).toHaveText('أنشئ إطلالتي');
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
  await page.getByTestId('kin-add-piece').click();
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
  let sentBody: Record<string, unknown> | undefined;
  let savedBody: Record<string, unknown> | undefined;
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'item-42', itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', ownershipStatus: 'owned', createdAt: new Date().toISOString() }] }),
      });
    }
  });
  await page.route('**/api/kin/search', async (route) => {
    sentBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() });
  });
  await page.route('**/api/kin/saved', async (route) => {
    savedBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-my-things').click();
  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-style-piece').click();
  await expect(page.getByTestId('kin-styling-summary')).toBeVisible();
  await page.getByTestId('kin-submit').click();
  await expect.poll(() => sentBody?.query).toBe('Style my selected piece');
  expect(sentBody?.myThingsItemIds).toEqual(['item-42']);
  expect(sentBody?.occasion).toBe('Everyday');
  await expect(page.getByTestId('kin-look-reference').getByRole('img')).toHaveAttribute('src', '/api/closet-items/item-42/image');
  await page.getByTestId('kin-save').click();
  await expect(page.getByTestId('kin-save')).toHaveText('Saved');
  expect(savedBody?.query).toBe(sentBody?.query);
  const pieceCard = page.getByTestId('kin-piece-card');
  await expect(pieceCard).toBeVisible();
  await expect(pieceCard).toContainText('Your piece');
  // "Change" on a completed result's piece card still hands off to My
  // Things via the same changeStylingItems()/go('myThings') plumbing as
  // before — there is no longer a dedicated "continue" step to land on.
  await pieceCard.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Closet' })).toBeVisible();
});

test('choosing a photo replaces a preselected My Things piece everywhere before submission', async ({ page }) => {
  await mockMe(page, { kinSearch: true, myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'item-42', itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', ownershipStatus: 'owned', createdAt: new Date().toISOString() }] }),
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
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-my-things').click();
  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-style-piece').click();
  await expect(page.getByTestId('kin-styling-summary').locator('img')).toHaveAttribute('src', '/api/closet-items/item-42/image');

  // The corner refresh icon now opens the shared "Add a Piece" sheet
  // instead of navigating away directly.
  await page.getByTestId('kin-piece-change').click();
  await page.getByTestId('kin-photo-input').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('replacement-photo') });
  await expect(page.getByTestId('kin-styling-summary').getByRole('img', { name: 'Selected styling piece' })).toHaveAttribute('src', /^blob:/);
  await expect(page.getByTestId('kin-styling-summary').locator('img[src="/api/closet-items/item-42/image"]')).toHaveCount(0);
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-look-reference').getByRole('img')).toHaveAttribute('src', /^blob:/);
  expect(photoCalls).toBe(1);
  expect(searchCalls).toBe(0);
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
  await page.getByTestId('kin-add-piece').click();
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
        body: JSON.stringify({ items: [{ id: 'item-42', itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null, brand: null, confirmationStatus: 'confirmed', ownershipStatus: 'owned', createdAt: new Date().toISOString() }] }),
      });
    }
  });
  await page.route('**/api/kin/search', async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkPlainAnswerBody() }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-my-things').click();
  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-style-piece').click();
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
  await page.getByTestId('kin-add-piece').click();
  await page.getByTestId('kin-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-looks-options')).toBeVisible();
  expect(new URL(sentUrl).searchParams.get('locale')).toBe('ar');
});

test('an Arabic blank-description photo request sends the localized fallback query and preserves the photo and occasion', async ({ page }) => {
  await mockMe(page, { kinSearch: true, language: 'ar' });
  let sentUrl = '';
  let uploadedBody: Buffer | null = null;
  let savedQuery: unknown;
  await page.route('**/api/kin/looks/photo*', async (route) => {
    sentUrl = route.request().url();
    uploadedBody = route.request().postDataBuffer();
    await route.fulfill({ status: 200, contentType: 'application/json', body: looksOkBody() });
  });
  await page.route('**/api/kin/saved', async (route) => {
    savedQuery = route.request().postDataJSON()?.query;
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-add-piece').click();
  await page.getByTestId('kin-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('blank-description-photo') });
  await page.getByTestId('kin-submit').click();
  await expect(page.getByTestId('kin-look-reference').getByRole('img')).toHaveAttribute('src', /^blob:/);
  const params = new URL(sentUrl).searchParams;
  expect(params.get('query')).toBe('نسّق قطعتي المختارة');
  expect(params.get('occasion')).toBe('Everyday');
  expect(params.get('locale')).toBe('ar');
  expect(uploadedBody?.toString()).toBe('blank-description-photo');
  await page.getByTestId('kin-save').click();
  await expect(page.getByTestId('kin-save')).toHaveText('تم الحفظ');
  expect(savedQuery).toBe(params.get('query'));
});

// --- KIN Travel: optional accommodation (Hotels / Apartments & Homes) ------

function stayFixture(kind: 'hotel' | 'apartment', index: number) {
  return {
    kind,
    placeId: `${kind}-${index}`,
    name: `${kind === 'hotel' ? 'Hotel' : 'Apartment'} ${index}`,
    formattedAddress: `${index} Stay Street, Old Town`,
    lat: 48.85 + index * 0.001,
    lng: 2.35,
    rating: 4.2 + index * 0.1,
    priceLevel: index === 3 ? null : (index % 3) + 1,
    websiteUrl: index === 1 ? 'https://hotel-one.example.com' : null,
    mapsUrl: `https://maps.google.com/?cid=${kind}-${index}`,
    photoUrl: null,
    photoAttribution: index === 1 ? 'Stay Photographer' : null,
    reason: index === 3 ? null : `KIN reason for ${kind} ${index}`,
  };
}

function planWithStays(destination: string, stays: Record<string, unknown> | undefined) {
  return {
    status: 'ok',
    plan: {
      destination,
      narrative: '',
      citations: [],
      days: [{
        dayIndex: 0,
        date: null,
        routes: [],
        places: [{ placeId: 'stop-1', name: 'Museum Stop', formattedAddress: null, lat: 48.86, lng: 2.34, rating: 4.6, websiteUrl: null, mapsUrl: 'https://maps.google.com/?cid=stop-1', photoUrl: null, photoAttribution: null, slot: null, activityInterest: 'museums', openingHours: null }],
      }],
      ...(stays ? { stays } : {}),
    },
  };
}

async function gotoTravelInterests(page: Page, destination: string) {
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill(destination);
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByRole('heading', { name: 'Choose your interests' })).toBeVisible();
}

test('Travel step 2 offers optional Hotels and Apartments & Homes cards first; with neither picked the request carries no accommodation and the plan has no Stay options', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  let sentBody: Record<string, unknown> | undefined;
  await page.route('**/api/kin/travel/plan', async (route) => {
    sentBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(planWithStays('Rome', undefined)) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await gotoTravelInterests(page, 'Rome');
  const cards = page.getByTestId('kin-interest-grid').locator('.kin-interest-card');
  await expect(cards.nth(0)).toHaveText('Hotels');
  await expect(cards.nth(1)).toHaveText('Apartments & Homes');
  await expect(page.getByTestId('kin-interest-hotels')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('kin-interest-apartments')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('kin-stay-sheet')).toHaveCount(0);
  await page.getByTestId('kin-interest-museums').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect.poll(() => sentBody?.destination).toBe('Rome');
  expect(sentBody?.accommodation).toBeUndefined();
  await expect(page.getByTestId('kin-day-preview')).toBeVisible();
  await expect(page.getByTestId('kin-stays')).toHaveCount(0);
  await expect(page.getByText('Stay options')).toHaveCount(0);
});

test('Hotels opens the Hotel preferences sheet; star and budget picks are sent as structured accommodation; Stay options render once above Day 1 with details, select, and paging', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  let sentBody: Record<string, unknown> | undefined;
  let planCalls = 0;
  let staysBody: Record<string, unknown> | undefined;
  await page.route('**/api/kin/travel/plan', async (route) => {
    planCalls += 1;
    sentBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(planWithStays('Paris', { hotels: { items: [stayFixture('hotel', 1), stayFixture('hotel', 2), stayFixture('hotel', 3)], hasMore: true } })) });
  });
  await page.route('**/api/kin/travel/stays', async (route) => {
    staysBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', items: [stayFixture('hotel', 4), stayFixture('hotel', 5), stayFixture('hotel', 6)], hasMore: false }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await gotoTravelInterests(page, 'Paris');

  await page.getByTestId('kin-interest-hotels').click();
  const sheet = page.getByTestId('kin-stay-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Hotel preferences' })).toBeVisible();
  await expect(sheet.getByText('Star rating')).toBeVisible();
  await expect(sheet.getByText('Budget per night')).toBeVisible();
  await expect(sheet.getByText('Stay type')).toHaveCount(0);
  for (const label of ['3 Stars', '4 Stars', '5 Stars', 'Any rating', '$', '$$', '$$$']) await expect(sheet.getByText(label, { exact: true })).toBeVisible();
  // Star rating is only ever a search preference — the sheet says so.
  await expect(page.getByTestId('kin-stay-stars-hint')).toHaveText("A search preference only — KIN can't verify a hotel's official star class.");
  await page.getByTestId('kin-stay-stars-4').click();
  await expect(page.getByTestId('kin-stay-stars-4')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('kin-stay-budget-2').click();
  await page.getByTestId('kin-stay-done').click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('kin-interest-hotels')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kin-stay-summary-hotel')).toHaveText('4 Stars · $$');
  await page.getByTestId('kin-interest-cafes').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect.poll(() => sentBody?.destination).toBe('Paris');
  expect(sentBody?.interests).toEqual(['cafes']);
  expect(sentBody?.accommodation).toEqual({ hotels: { stars: 4, budget: 2 } });

  const stays = page.getByTestId('kin-stays');
  await expect(stays).toBeVisible();
  await expect(stays.getByText('Stay options')).toBeVisible();
  await expect(page.getByTestId('kin-stay-tabs')).toHaveCount(0);
  const cards = page.getByTestId('kin-stay-card');
  await expect(cards).toHaveCount(3);
  const first = cards.nth(0);
  await expect(first).toContainText('Hotel 1');
  await expect(first).toContainText('1 Stay Street, Old Town');
  await expect(first.getByTestId('kin-stay-rating')).toHaveText('4.3 · Google rating');
  // Google's price band is labeled as exactly that — never presented as a nightly rate.
  await expect(first.getByTestId('kin-stay-price')).toHaveText('Price level: $$');
  await expect(page.getByText(/per night/)).toHaveCount(0);
  await expect(first.getByTestId('kin-stay-reason')).toHaveText('KIN reason for hotel 1');
  await expect(first).toContainText('Stay Photographer');
  // A stay with no Google price band and no reason says so, and shows nothing invented.
  const third = cards.nth(2);
  await expect(third.getByTestId('kin-stay-price')).toHaveText('Price unavailable');
  await expect(third.getByTestId('kin-stay-reason')).toHaveCount(0);
  // Once, above the first day — never inside a day's timeline.
  const [staysBox, toggleBox, dayBox] = await Promise.all([stays.boundingBox(), page.getByTestId('kin-plan-route-toggle').boundingBox(), page.getByTestId('kin-day-preview').boundingBox()]);
  expect(staysBox!.y + staysBox!.height).toBeLessThanOrEqual(toggleBox!.y);
  expect(staysBox!.y + staysBox!.height).toBeLessThanOrEqual(dayBox!.y);
  await expect(page.getByTestId('kin-day-preview').getByTestId('kin-stay-card')).toHaveCount(0);

  // Select is a single choice per kind.
  await first.getByTestId('kin-stay-select').click();
  await expect(first.getByTestId('kin-stay-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(first.getByTestId('kin-stay-select')).toHaveText('Selected');
  await expect(first).toHaveAttribute('data-selected', 'true');
  await cards.nth(1).getByTestId('kin-stay-select').click();
  await expect(first).toHaveAttribute('data-selected', 'false');
  await expect(cards.nth(1)).toHaveAttribute('data-selected', 'true');

  // View details shows the same real facts plus the stay's own links.
  await first.getByTestId('kin-stay-details').click();
  const details = page.getByTestId('kin-stay-details-sheet');
  await expect(details).toBeVisible();
  await expect(details).toContainText('Hotel 1');
  await expect(details).toContainText('KIN reason for hotel 1');
  await expect(details.getByTestId('kin-stay-website')).toHaveAttribute('href', 'https://hotel-one.example.com');
  await expect(details.getByTestId('kin-stay-maps')).toHaveAttribute('href', 'https://maps.google.com/?cid=hotel-1');
  await expect(details.getByTestId('kin-stay-details-select')).toHaveText('Select this stay');
  await details.getByTestId('kin-stay-details-select').click();
  await expect(details.getByTestId('kin-stay-details-select')).toHaveText('Selected');
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(first).toHaveAttribute('data-selected', 'true');
  await expect(cards.nth(1)).toHaveAttribute('data-selected', 'false');

  // Show more stays appends a new page from the same submitted preferences and never re-plans.
  const more = page.getByTestId('kin-stays-more');
  await expect(more).toHaveText('Show more stays');
  await more.click();
  await expect.poll(() => staysBody?.kind).toBe('hotel');
  expect(staysBody).toEqual({ destination: 'Paris', kind: 'hotel', accommodation: { hotels: { stars: 4, budget: 2 } }, excludePlaceIds: ['hotel-1', 'hotel-2', 'hotel-3'], locale: 'en' });
  await expect(cards).toHaveCount(6);
  await expect(cards.nth(3)).toContainText('Hotel 4');
  await expect(first).toHaveAttribute('data-selected', 'true');
  await expect(more).toBeDisabled();
  await expect(more).toHaveText('No more stays');
  expect(planCalls).toBe(1);
  await expect(page.getByTestId('kin-travel-place')).toHaveCount(1);
});

test('both cards: Remove deselects from the sheet, Any rating sends no stars, the Apartment sheet has stay type, accommodation alone is a valid request, and Stay options get Hotels / Apartments & Homes tabs', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  let sentBody: Record<string, unknown> | undefined;
  await page.route('**/api/kin/travel/plan', async (route) => {
    sentBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(planWithStays('Lisbon', {
      hotels: { items: [stayFixture('hotel', 1), stayFixture('hotel', 2), stayFixture('hotel', 3)], hasMore: false },
      apartments: { items: [stayFixture('apartment', 1), stayFixture('apartment', 2)], hasMore: false },
    })) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await gotoTravelInterests(page, 'Lisbon');

  await page.getByTestId('kin-interest-hotels').click();
  await page.getByTestId('kin-stay-remove').click();
  await expect(page.getByTestId('kin-stay-sheet')).toBeHidden();
  await expect(page.getByTestId('kin-interest-hotels')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('kin-interest-hotels').click();
  await page.getByTestId('kin-stay-stars-any').click();
  await page.getByTestId('kin-stay-done').click();
  await expect(page.getByTestId('kin-stay-summary-hotel')).toHaveText('Any rating');

  await page.getByTestId('kin-interest-apartments').click();
  const sheet = page.getByTestId('kin-stay-sheet');
  await expect(sheet.getByRole('heading', { name: 'Apartment preferences' })).toBeVisible();
  await expect(sheet.getByText('Stay type')).toBeVisible();
  await expect(sheet.getByText('Star rating')).toHaveCount(0);
  for (const label of ['Entire home', 'Apartment', 'Private room']) await expect(sheet.getByText(label, { exact: true })).toBeVisible();
  await page.getByTestId('kin-stay-type-entire_home').click();
  await page.getByTestId('kin-stay-budget-3').click();
  await page.getByTestId('kin-stay-done').click();
  await expect(page.getByTestId('kin-stay-summary-apartment')).toHaveText('Entire home · $$$');

  await page.getByTestId('kin-travel-submit').click();
  await expect.poll(() => sentBody?.destination).toBe('Lisbon');
  expect(sentBody?.interests).toBeUndefined();
  expect(sentBody?.accommodation).toEqual({ hotels: {}, apartments: { stayType: 'entire_home', budget: 3 } });

  const tabs = page.getByTestId('kin-stay-tabs');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByTestId('kin-stay-tab-hotel')).toHaveText('Hotels');
  await expect(tabs.getByTestId('kin-stay-tab-apartment')).toHaveText('Apartments & Homes');
  await expect(tabs.getByTestId('kin-stay-tab-hotel')).toHaveClass(/selected/);
  await expect(page.getByTestId('kin-stay-card')).toHaveCount(3);
  await expect(page.getByTestId('kin-stay-card').first()).toContainText('Hotel 1');
  await tabs.getByTestId('kin-stay-tab-apartment').click();
  await expect(tabs.getByTestId('kin-stay-tab-apartment')).toHaveClass(/selected/);
  await expect(page.getByTestId('kin-stay-card')).toHaveCount(2);
  await expect(page.getByTestId('kin-stay-card').first()).toContainText('Apartment 1');
  await expect(page.getByTestId('kin-stays-more')).toBeDisabled();
  await expect(page.getByTestId('kin-stays')).toHaveCount(1);
  await expect(page.getByTestId('kin-day-preview').getByTestId('kin-stay-card')).toHaveCount(0);
});

test('Arabic accommodation cards, preference sheet, and Stay options are RTL-safe with no horizontal overflow at 390×844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMe(page, { kinSearch: true, language: 'ar' });
  await page.route('**/api/kin/travel/plan', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(planWithStays('دبي', { hotels: { items: [stayFixture('hotel', 1), stayFixture('hotel', 2), stayFixture('hotel', 3)], hasMore: true } })) });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill('دبي');
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByTestId('kin-interest-hotels')).toHaveText('فنادق');
  await expect(page.getByTestId('kin-interest-apartments')).toHaveText('شقق ومنازل');
  await page.getByTestId('kin-interest-hotels').click();
  const sheet = page.getByTestId('kin-stay-sheet');
  await expect(sheet.getByRole('heading', { name: 'تفضيلات الفندق' })).toBeVisible();
  await expect(sheet.getByText('تصنيف النجوم', { exact: true })).toBeVisible();
  await expect(page.getByTestId('kin-stay-stars-hint')).toHaveText('تفضيل للبحث فقط — لا يمكن لكين التحقق من تصنيف النجوم الرسمي للفندق.');
  await expect(sheet.getByText('الميزانية لليلة', { exact: true })).toBeVisible();
  await expect(page.getByTestId('kin-stay-stars-4')).toHaveText('4 نجوم');
  await expect(page.getByTestId('kin-stay-stars-any')).toHaveText('أي تصنيف');
  const done = page.getByTestId('kin-stay-done');
  await expect(done).toHaveText('تم');
  // Measured once the sheet's slide-up has settled: it must span the full
  // 390px width from x=0 (not sit shifted in RTL), sit entirely inside the
  // viewport with Done and Remove reachable, lay the four star options out
  // as a 2×2 grid with nothing clipped, and the page itself must never
  // scroll horizontally.
  const layout = () => page.evaluate(() => {
    const rect = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect();
    const sheet = rect('kin-stay-sheet');
    const stars = ['kin-stay-stars-3', 'kin-stay-stars-4', 'kin-stay-stars-5', 'kin-stay-stars-any'].map(rect);
    return {
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      sheetX: sheet.x, sheetRight: sheet.right, sheetTop: sheet.y, doneBottom: rect('kin-stay-done').bottom, removeBottom: rect('kin-stay-remove').bottom, viewport: window.innerHeight,
      starsInside: stars.every((s) => s.x >= 0 && s.right <= 390),
      twoByTwo: stars[0].y === stars[1].y && stars[2].y === stars[3].y && stars[2].y > stars[0].y,
    };
  });
  await expect.poll(async () => {
    const l = await layout();
    return l.sheetX === 0 && l.sheetRight === 390 && l.sheetTop >= 0 && l.doneBottom <= l.viewport && l.removeBottom <= l.viewport && l.starsInside && l.twoByTwo;
  }).toBe(true);
  expect((await layout()).scrollWidth).toBe((await layout()).clientWidth);
  await page.getByTestId('kin-stay-stars-4').click();
  await done.click();
  await expect(page.getByTestId('kin-stay-summary-hotel')).toHaveText('4 نجوم');
  await page.getByTestId('kin-travel-submit').click();
  const stays = page.getByTestId('kin-stays');
  await expect(stays.getByText('خيارات الإقامة')).toBeVisible();
  await expect(page.getByTestId('kin-stay-card').first().getByTestId('kin-stay-details')).toHaveText('عرض التفاصيل');
  await expect(page.getByTestId('kin-stay-card').first().getByTestId('kin-stay-select')).toHaveText('اختيار');
  await expect(page.getByTestId('kin-stay-card').first().getByTestId('kin-stay-price')).toHaveText('مستوى السعر: $$');
  await expect(page.getByTestId('kin-stay-card').first().getByTestId('kin-stay-rating')).toHaveText('4.3 · تقييم Google');
  await expect(page.getByTestId('kin-stays-more')).toHaveText('عرض المزيد من الإقامات');
  const overview = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(overview.scrollWidth).toBe(overview.clientWidth);
});

test('the Arabic Travel headline agrees in gender with the destination: feminine by default, masculine for the known masculine country names', async ({ page }) => {
  await mockMe(page, { kinSearch: true, language: 'ar' });
  for (const [destination, headline] of [['باريس', 'باريس، مصمّمة على ذوقك.'], ['لبنان', 'لبنان، مصمّم على ذوقك.'], ['المغرب', 'المغرب، مصمّم على ذوقك.'], ['Paris', 'Paris، مصمّمة على ذوقك.']] as const) {
    await page.route('**/api/kin/travel/plan', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(planWithStays(destination, undefined)) });
    });
    await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-kin').click();
    await page.getByTestId('kin-mode-travel').click();
    await page.getByTestId('kin-destination').fill(destination);
    await page.getByTestId('kin-travel-next').click();
    await page.getByTestId('kin-interest-museums').click();
    await page.getByTestId('kin-travel-submit').click();
    await expect(page.locator('.kin-headline')).toHaveText(headline);
    await page.unroute('**/api/kin/travel/plan');
  }
});
