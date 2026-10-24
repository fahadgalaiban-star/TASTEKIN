import { expect, test, type Page } from '@playwright/test';

// Taste in KIN Travel (flag taste_everywhere) — the web app's side:
//  - step 2 "Choose your interests" opens with chips pre-selected from the
//    member's taste profile, with a hint line (EN/AR); the member can turn
//    any chip off and the request sends exactly what is on;
//  - with the flag off nothing is pre-selected and the preferences are not
//    even fetched;
//  - a plan stop the server marks fromCreator shows "from @username" in the
//    day timeline and in the Route list, with the real username only.
// Which places join the plan is the server's job: unit tests + verify:taste-everywhere.

function meBody(language: 'en' | 'ar', tasteEverywhere: boolean) {
  return JSON.stringify({
    user: { id: 'member', email: 'member@tastekin.test' }, role: 'consumer', creator: null, isAdmin: false, language,
    notifyPush: true, notifyEmail: true, supportEmail: null, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false,
    featureFlags: { kin_search: true, taste_ranking: true, taste_everywhere: tasteEverywhere },
  });
}

async function openTravel(page: Page, { language = 'en', tasteEverywhere = true }: { language?: 'en' | 'ar'; tasteEverywhere?: boolean } = {}) {
  const prefsCalls: string[] = [];
  await page.route('**/api/me', async (route) => route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody(language, tasteEverywhere) }));
  await page.route('**/api/taste-preferences', async (route) => {
    prefsCalls.push(route.request().method());
    await route.fulfill({ json: { categories: ['Restaurants'], tags: ['coffee-stops', 'long-lunches'], complete: true, updatedAt: '2026-10-01T00:00:00.000Z' } });
  });
  await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-travel-step')).toHaveAttribute('data-step', '1');
  return prefsCalls;
}

for (const language of ['en', 'ar'] as const) {
  test(`step 2 opens with Cafés and Dinner pre-selected from a café-and-lunch taste, says so, and stays editable (${language})`, async ({ page }) => {
    const prefsCalls = await openTravel(page, { language });
    let sentBody: Record<string, unknown> | undefined;
    await page.route('**/api/kin/travel/plan', async (route) => {
      sentBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { status: 'ok', plan: { destination: 'Paris', narrative: '', citations: [], days: [] } } });
    });
    await page.getByTestId('kin-destination').fill('Paris');
    await page.getByTestId('kin-travel-next').click();
    await expect(page.getByTestId('kin-travel-step')).toHaveAttribute('data-step', '2');
    await expect(page.getByTestId('kin-taste-preselected')).toHaveText(language === 'ar' ? 'اخترناها مسبقًا من ذوقك. غيّر ما تشاء.' : 'Pre-selected from your taste. Change anything.');
    await expect(page.getByTestId('kin-interest-cafes')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('kin-interest-dinner')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('kin-interest-museums')).toHaveAttribute('aria-pressed', 'false');
    expect(prefsCalls).toEqual(['GET']);
    // The member turns Dinner off: the request carries exactly what is on.
    await page.getByTestId('kin-interest-dinner').click();
    await expect(page.getByTestId('kin-interest-dinner')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('kin-travel-submit').click();
    await expect.poll(() => sentBody).toBeTruthy();
    expect(sentBody!.interests).toEqual(['cafes']);
    expect(sentBody!.destination).toBe('Paris');
  });
}

test('with taste_everywhere off nothing is pre-selected and the taste profile is not fetched', async ({ page }) => {
  const prefsCalls = await openTravel(page, { tasteEverywhere: false });
  await page.getByTestId('kin-destination').fill('Paris');
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByTestId('kin-travel-step')).toHaveAttribute('data-step', '2');
  await expect(page.getByTestId('kin-taste-preselected')).toHaveCount(0);
  for (const chip of ['cafes', 'dinner', 'breakfast', 'museums']) await expect(page.getByTestId(`kin-interest-${chip}`)).toHaveAttribute('aria-pressed', 'false');
  expect(prefsCalls).toEqual([]);
});

test('chips the member already touched are never overridden by the taste suggestion', async ({ page }) => {
  await openTravel(page);
  await page.getByTestId('kin-destination').fill('Paris');
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByTestId('kin-interest-cafes')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('kin-interest-cafes').click();
  await page.getByTestId('kin-interest-parks').click();
  // Back to step 1 and forward again: the member's own choices stand.
  await page.getByTestId('kin-travel-back').click();
  await expect(page.getByTestId('kin-travel-step')).toHaveAttribute('data-step', '1');
  await page.getByTestId('kin-travel-next').click();
  await expect(page.getByTestId('kin-interest-cafes')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('kin-interest-parks')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kin-interest-dinner')).toHaveAttribute('aria-pressed', 'true');
});

const stop = (placeId: string, name: string, extra: Record<string, unknown> = {}) => ({
  placeId, name, formattedAddress: `${name}, Paris`, lat: 48.85, lng: 2.35, rating: null, websiteUrl: null, mapsUrl: `https://maps.google.com/?q=${placeId}`,
  photoUrl: null, photoAttribution: null, slot: null, openingHours: null, venueKind: 'restaurant', ...extra,
});

for (const language of ['en', 'ar'] as const) {
  test(`a stop from a saved Edit or followed creator says "from @username" in the timeline and the Route list (${language})`, async ({ page }) => {
    await openTravel(page, { language });
    await page.route('**/api/kin/travel/plan', async (route) => route.fulfill({
      json: {
        status: 'ok',
        plan: {
          destination: 'Paris', narrative: '', citations: [],
          days: [{ dayIndex: 0, date: null, routes: [], places: [
            stop('p1', 'Septime', { fromCreator: { username: 'fheed', displayName: 'Fheed Alaiban', editId: 'edit-septime', via: 'saved' } }),
            stop('p2', 'Clown Bar'),
          ] }],
        },
      },
    }));
    await page.getByTestId('kin-destination').fill('Paris');
    await page.getByTestId('kin-travel-next').click();
    await page.getByTestId('kin-travel-submit').click();
    const places = page.getByTestId('kin-travel-place');
    await expect(places).toHaveCount(2);
    await expect(places.nth(0).getByTestId('kin-place-from-creator')).toHaveText(language === 'ar' ? 'من @fheed' : 'from @fheed');
    await expect(places.nth(1).getByTestId('kin-place-from-creator')).toHaveCount(0);
    // Never a number next to it.
    await expect(places.nth(0)).not.toContainText(/\d+ (followers|likes|saves)/);
    await page.getByRole('button', { name: language === 'ar' ? 'المسار' : 'Route' }).click();
    const items = page.getByTestId('kin-route-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).getByTestId('kin-route-from-creator')).toHaveText(language === 'ar' ? 'من @fheed' : 'from @fheed');
    await expect(items.nth(1).getByTestId('kin-route-from-creator')).toHaveCount(0);
  });
}
