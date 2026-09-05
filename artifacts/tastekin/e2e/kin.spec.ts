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

test('Travel mode: Optional details shows destination/dates, not size', async ({ page }) => {
  await mockMe(page, { kinSearch: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-travel').click();
  await page.getByText('Optional details', { exact: true }).click();
  await expect(page.getByTestId('kin-destination')).toBeVisible();
  await expect(page.getByTestId('kin-start-date')).toBeVisible();
  await expect(page.getByTestId('kin-end-date')).toBeVisible();
  await expect(page.getByTestId('kin-size')).toHaveCount(0);
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

function looksOkBody(overrides: { answer?: string; results?: unknown[]; webSearchDegraded?: boolean } = {}) {
  return JSON.stringify({
    status: 'ok',
    answer: overrides.answer ?? '',
    citations: [],
    results: overrides.results ?? [],
    options: [{ label: 'signature', reasoning: 'A tailored navy look for tonight.', ownedItems: [], missingItems: [] }],
    webSearchDegraded: overrides.webSearchDegraded ?? false,
  });
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
