import { expect, test, type Page } from '@playwright/test';

// KIN Travel referrals: car rental and restaurant reservations. TASTEKIN is
// a referral intermediary only — each feature is behind its own server flag
// (OFF by default), the server only emits referral data while a flag is on,
// and the client independently hides everything referral-related unless the
// flag from /api/me is on. These tests feed the client a plan that ALREADY
// carries referral data and prove the client shows it only when its flag is
// on (defense in depth), renders https links in a new tab, and puts the
// reservation link on restaurants/cafés only.

type Flags = { carRental?: boolean; reservations?: boolean };

function meBody(language: 'en' | 'ar', flags: Flags) {
  return JSON.stringify({
    user: { id: 'kin-referrals-user', email: 'kin-referrals@tastekin.test' },
    role: 'consumer', creator: null, isAdmin: false, language, notifyPush: true, notifyEmail: true, supportEmail: null,
    needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false,
    featureFlags: { kin_search: true, kin_travel_car_rental: flags.carRental === true, kin_travel_restaurant_reservations: flags.reservations === true },
  });
}

const CAR_RENTAL_URL = 'https://cars.partner.example/search?city=Madrid&from=2026-10-03&to=2026-10-09';
const RESERVE_URL = 'https://tables.partner.example/reserve?q=Casa%20Lucio&near=Madrid';

function place(overrides: Record<string, unknown>) {
  return {
    placeId: 'p', name: 'Place', formattedAddress: 'Madrid', lat: 40.4, lng: -3.7, rating: 4.5, websiteUrl: null, mapsUrl: 'https://maps.google.com/?cid=1',
    photoUrl: null, photoAttribution: null, slot: null, openingHours: null, venueKind: null, ...overrides,
  };
}

function planBody(options: { carRental?: string | null; reserveUrl?: string | null } = {}) {
  const reserveUrl = options.reserveUrl === undefined ? RESERVE_URL : options.reserveUrl;
  const carRental = options.carRental === undefined ? CAR_RENTAL_URL : options.carRental;
  return JSON.stringify({
    status: 'ok',
    plan: {
      destination: 'Madrid', narrative: '', citations: [],
      days: [{
        dayIndex: 0, date: '2026-10-03',
        places: [
          place({ placeId: 'museum-1', name: 'Museo del Prado', activityInterest: 'museums', venueKind: null }),
          place({ placeId: 'restaurant-1', name: 'Casa Lucio', slot: 'DINNER', venueKind: 'restaurant', ...(reserveUrl ? { reservation: { url: reserveUrl, partnerName: 'TablePartner' } } : {}) }),
          place({ placeId: 'cafe-1', name: 'Café de Oriente', slot: 'COFFEE', venueKind: 'cafe', ...(reserveUrl ? { reservation: { url: reserveUrl.replace('Casa%20Lucio', 'Cafe'), partnerName: 'TablePartner' } } : {}) }),
        ],
        routes: [],
      }],
      ...(carRental ? { referrals: { carRental: { url: carRental, partnerName: 'CarPartner' } } } : {}),
    },
  });
}

async function openTravelPlan(page: Page, language: 'en' | 'ar', flags: Flags, plan: string = planBody()) {
  await page.addInitScript(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('tastekin:')) localStorage.removeItem(key); });
  await page.route('**/api/me', async (route) => { await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody(language, flags) }); });
  await page.route('**/api/kin/travel/plan', async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', body: plan }); });
  await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByTestId('kin-destination').fill('Madrid');
  await page.getByTestId('kin-start-date').fill('2026-10-03');
  await page.getByTestId('kin-end-date').fill('2026-10-09');
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-interest-museums').click();
  await page.getByTestId('kin-travel-submit').click();
  await expect(page.getByTestId('kin-travel-place')).toHaveCount(3);
}

async function expectSecureExternalLink(page: Page, testId: string, href: string) {
  const link = page.getByTestId(testId);
  await expect(link).toHaveAttribute('href', href);
  await expect(link).toHaveAttribute('target', '_blank');
  const rel = (await link.getAttribute('rel')) ?? '';
  expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
}

test('both flags ON (English): car rental card with destination and dates, reservation link on the restaurant and café only, all links secure', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: true, reservations: true });

  await expect(page.getByTestId('kin-car-rental')).toBeVisible();
  await expect(page.getByTestId('kin-car-rental')).toContainText('Need a car in Madrid?');
  await expect(page.getByTestId('kin-car-rental')).toContainText('travel dates are pre-filled');
  await expect(page.getByTestId('kin-car-rental-link')).toContainText('Rent a car with CarPartner');
  await expectSecureExternalLink(page, 'kin-car-rental-link', CAR_RENTAL_URL);
  await expect(page.getByTestId('kin-car-rental-disclaimer')).toContainText('TASTEKIN only refers you to the partner');
  await expect(page.getByTestId('kin-car-rental-disclaimer')).toContainText('insurance');

  const reserveLinks = page.getByTestId('kin-reserve-table');
  await expect(reserveLinks).toHaveCount(2);
  const cards = page.getByTestId('kin-travel-place');
  await expect(cards.nth(0)).toContainText('Museo del Prado');
  await expect(cards.nth(0).getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(cards.nth(1).getByTestId('kin-reserve-table')).toHaveText(/Reserve a table/);
  await expect(cards.nth(1).getByTestId('kin-reserve-table')).toHaveAttribute('aria-label', 'Reserve a table at Casa Lucio with TablePartner');
  await expect(cards.nth(2).getByTestId('kin-reserve-table')).toHaveText(/Reserve a table/);
  for (const link of await reserveLinks.all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    expect(((await link.getAttribute('rel')) ?? '').split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    expect(await link.getAttribute('href')).toMatch(/^https:\/\/tables\.partner\.example\//);
  }
  await expect(page.getByTestId('kin-reservation-disclaimer')).toContainText("Table reservations open on TablePartner's site");
  await expect(page.getByTestId('kin-reservation-disclaimer')).toContainText('TASTEKIN only refers you');
});

test('both flags OFF: nothing referral-related renders even when the plan payload carries referral data', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: false, reservations: false });
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await expect(page.getByTestId('kin-car-rental-link')).toHaveCount(0);
  await expect(page.getByTestId('kin-car-rental-disclaimer')).toHaveCount(0);
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(page.getByTestId('kin-reservation-disclaimer')).toHaveCount(0);
  await expect(page.getByText(/Rent a car|Reserve a table|Car rental|CarPartner|TablePartner/)).toHaveCount(0);
  await expect(page.locator('a[href*="partner.example"]')).toHaveCount(0);
  // The rest of the plan is untouched.
  await expect(page.getByTestId('kin-travel-place')).toHaveCount(3);
  await expect(page.getByTestId('kin-add-to-trip')).toHaveCount(3);
});

test('flags are independent: only the enabled feature appears', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: true, reservations: false });
  await expect(page.getByTestId('kin-car-rental')).toBeVisible();
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(page.getByTestId('kin-reservation-disclaimer')).toHaveCount(0);
});

test('reservations ON, car rental OFF: reservation links appear, the car rental card does not', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: false, reservations: true });
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(2);
});

test('flags ON but the server sent no referral data (partner not configured): nothing renders', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: true, reservations: true }, planBody({ carRental: null, reserveUrl: null }));
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(page.getByTestId('kin-reservation-disclaimer')).toHaveCount(0);
});

test('a non-https referral URL is never rendered, even with the flags on', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: true, reservations: true }, planBody({ carRental: 'http://cars.partner.example/insecure', reserveUrl: 'javascript:alert(1)' }));
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
});

test('Arabic/RTL: both referrals render with Arabic copy and secure links', async ({ page }) => {
  await openTravelPlan(page, 'ar', { carRental: true, reservations: true });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('kin-car-rental')).toContainText('هل تحتاج سيارة في');
  await expect(page.getByTestId('kin-car-rental-link')).toContainText('استأجر سيارة عبر CarPartner');
  await expectSecureExternalLink(page, 'kin-car-rental-link', CAR_RENTAL_URL);
  await expect(page.getByTestId('kin-car-rental-disclaimer')).toContainText('يقتصر دور TASTEKIN على إحالتك إلى الشريك');
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(2);
  await expect(page.getByTestId('kin-reserve-table').first()).toHaveText(/احجز طاولة/);
  await expect(page.getByTestId('kin-reservation-disclaimer')).toContainText('يقتصر دور TASTEKIN على إحالتك');
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
});
