import { expect, test, type Page } from '@playwright/test';

// KIN Travel referrals: car rental and restaurant reservations. TASTEKIN is
// a referral intermediary only — each feature is behind its own server flag
// (OFF by default), the server only emits referral data while a flag is on,
// and the client independently hides everything referral-related unless the
// flag from /api/me is on. These tests feed the client a plan that ALREADY
// carries referral data and prove the client shows it only when its flag is
// on (defense in depth), renders https links in a new tab with the required
// rel, places the car-rental card directly below the trip summary and before
// Day 1, and puts the reservation pill beside the existing actions of
// restaurant/café stops only.

type Flags = { carRental?: boolean; reservations?: boolean };

const REFERRAL_REL = 'noopener noreferrer sponsored';

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

function planBody(options: { carRental?: string | null; reserveUrl?: string | null; reserveOnMuseum?: boolean } = {}) {
  const reserveUrl = options.reserveUrl === undefined ? RESERVE_URL : options.reserveUrl;
  const carRental = options.carRental === undefined ? CAR_RENTAL_URL : options.carRental;
  const reservation = (url: string) => ({ reservation: { url, partnerName: 'TablePartner' } });
  return JSON.stringify({
    status: 'ok',
    plan: {
      destination: 'Madrid', narrative: '', citations: [],
      days: [{
        dayIndex: 0, date: '2026-10-03',
        places: [
          // A museum never gets a reservation — not even if the payload carried one (venueKind is null).
          place({ placeId: 'museum-1', name: 'Museo del Prado', activityInterest: 'museums', venueKind: null, ...(options.reserveOnMuseum ? reservation(RESERVE_URL) : {}) }),
          place({ placeId: 'restaurant-1', name: 'Casa Lucio', slot: 'DINNER', venueKind: 'restaurant', ...(reserveUrl ? reservation(reserveUrl) : {}) }),
          place({ placeId: 'cafe-1', name: 'Café de Oriente', slot: 'COFFEE', venueKind: 'cafe', ...(reserveUrl ? reservation(reserveUrl.replace('Casa%20Lucio', 'Cafe')) : {}) }),
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
  // The trip setup steps never carry a car-rental question or card, whatever the flags say.
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await page.getByTestId('kin-travel-next').click();
  await page.getByTestId('kin-interest-museums').click();
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await page.getByTestId('kin-travel-submit').click();
  await expect(page.getByTestId('kin-travel-place')).toHaveCount(3);
}

async function expectSecureExternalLink(page: Page, testId: string, href: string) {
  const link = page.getByTestId(testId);
  await expect(link).toHaveAttribute('href', href);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', REFERRAL_REL);
}

test('both flags ON (English): burgundy car-rental card directly below the trip summary and before Day 1; reservation pill beside the existing actions on the restaurant and café only; every referral link is secure and sponsored', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: true, reservations: true });

  const card = page.getByTestId('kin-car-rental');
  await expect(card).toBeVisible();
  // Placement: immediately after the trip summary hero, and before the day-1 preview.
  await expect(page.locator('[data-testid="kin-travel-hero"] + [data-testid="kin-car-rental"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="kin-car-rental"] ~ [data-testid="kin-day-preview"]')).toHaveCount(1);
  await expect(card).toContainText('Need a car in Madrid?');
  await expect(card).toContainText('Compare rental cars for your selected travel dates.');
  await expect(page.getByTestId('kin-car-rental-link')).toHaveText(/View rental cars/);
  await expectSecureExternalLink(page, 'kin-car-rental-link', CAR_RENTAL_URL);
  await expect(page.getByTestId('kin-car-rental-disclaimer')).toContainText('continue on CarPartner');
  await expect(page.getByTestId('kin-car-rental-disclaimer')).toContainText('Booking, payment, insurance, changes, cancellations and support are handled by CarPartner.');

  const cards = page.getByTestId('kin-travel-place');
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Museo del Prado');
  await expect(cards.nth(0).getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(cards.nth(0).getByTestId('kin-reservation-disclaimer')).toHaveCount(0);
  for (const index of [1, 2]) {
    const stop = cards.nth(index);
    // Inside the existing actions row, after the name (never above it), next to Directions and Save to trip, which are untouched.
    await expect(stop.locator('.kin-timeline-name ~ .kin-timeline-actions [data-testid="kin-reserve-table"]')).toHaveCount(1);
    await expect(stop.locator('.kin-timeline-actions a').first()).toHaveText('Directions');
    await expect(stop.getByTestId('kin-add-to-trip')).toHaveCount(1);
    await expect(stop.getByTestId('kin-swap-place')).toHaveCount(1);
    const link = stop.getByTestId('kin-reserve-table');
    await expect(link).toHaveText(/Reserve a table/);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', REFERRAL_REL);
    expect(await link.getAttribute('href')).toMatch(/^https:\/\/tables\.partner\.example\//);
    await expect(stop.getByTestId('kin-reservation-disclaimer')).toContainText('Reservation opens on TablePartner');
    await expect(stop.getByTestId('kin-reservation-disclaimer')).toContainText('Payment, changes, cancellations and support are handled by TablePartner.');
  }
  await expect(cards.nth(1).getByTestId('kin-reserve-table')).toHaveAttribute('aria-label', 'Reserve a table at Casa Lucio with TablePartner');
  // No separate reservation section anywhere: the notes live inside the two eligible cards only.
  await expect(page.getByTestId('kin-reservation-disclaimer')).toHaveCount(2);
});

test('both flags OFF: nothing referral-related renders even when the plan payload carries referral data, and the stop cards are exactly as before', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: false, reservations: false });
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await expect(page.getByTestId('kin-car-rental-link')).toHaveCount(0);
  await expect(page.getByTestId('kin-car-rental-disclaimer')).toHaveCount(0);
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(page.getByTestId('kin-reservation-disclaimer')).toHaveCount(0);
  await expect(page.getByText(/Rent a car|View rental cars|Need a car|Reserve a table|Reservation opens|Car rental|CarPartner|TablePartner/)).toHaveCount(0);
  await expect(page.locator('a[href*="partner.example"]')).toHaveCount(0);
  await expect(page.locator('a[rel~="sponsored"]')).toHaveCount(0);
  // The rest of the plan is untouched: the hero is followed directly by the plan controls, every stop keeps Directions, Save to trip and Swap.
  await expect(page.getByTestId('kin-travel-place')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /in Google Maps/ })).toHaveCount(3);
  await expect(page.getByTestId('kin-add-to-trip')).toHaveCount(3);
  await expect(page.getByTestId('kin-swap-place')).toHaveCount(3);
  await expect(page.locator('.kin-timeline-actions a, .kin-timeline-actions button')).toHaveCount(6);
});

test('flags are independent: car rental ON, reservations OFF', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: true, reservations: false });
  await expect(page.getByTestId('kin-car-rental')).toBeVisible();
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(page.getByTestId('kin-reservation-disclaimer')).toHaveCount(0);
});

test('flags are independent: reservations ON, car rental OFF', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: false, reservations: true });
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(2);
  await expect(page.getByTestId('kin-reservation-disclaimer')).toHaveCount(2);
});

test('flags ON but the server sent no referral data (partner not configured): nothing renders', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: true, reservations: true }, planBody({ carRental: null, reserveUrl: null }));
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(page.getByTestId('kin-reservation-disclaimer')).toHaveCount(0);
});

test('a non-restaurant place never gets a reservation pill, even if a reservation slipped into its payload', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: false, reservations: true }, planBody({ reserveOnMuseum: true }));
  const cards = page.getByTestId('kin-travel-place');
  await expect(cards.nth(0)).toContainText('Museo del Prado');
  await expect(cards.nth(0).getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(2);
});

test('a non-https referral URL is never rendered, even with the flags on', async ({ page }) => {
  await openTravelPlan(page, 'en', { carRental: true, reservations: true }, planBody({ carRental: 'http://cars.partner.example/insecure', reserveUrl: 'javascript:alert(1)' }));
  await expect(page.getByTestId('kin-car-rental')).toHaveCount(0);
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
});

test('Arabic/RTL: both referrals render with Arabic copy and secure sponsored links, no horizontal overflow', async ({ page }) => {
  await openTravelPlan(page, 'ar', { carRental: true, reservations: true });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('kin-car-rental')).toContainText('هل تحتاج سيارة في');
  await expect(page.getByTestId('kin-car-rental')).toContainText('قارن سيارات الإيجار لتواريخ سفرك المحددة');
  await expect(page.getByTestId('kin-car-rental-link')).toContainText('عرض سيارات الإيجار');
  await expectSecureExternalLink(page, 'kin-car-rental-link', CAR_RENTAL_URL);
  await expect(page.getByTestId('kin-car-rental-disclaimer')).toContainText('ستتابع على موقع CarPartner');
  await expect(page.getByTestId('kin-reserve-table')).toHaveCount(2);
  await expect(page.getByTestId('kin-reserve-table').first()).toHaveText(/احجز طاولة/);
  await expect(page.getByTestId('kin-reserve-table').first()).toHaveAttribute('rel', REFERRAL_REL);
  await expect(page.getByTestId('kin-reservation-disclaimer').first()).toContainText('يُفتح الحجز على موقع TablePartner');
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
});
