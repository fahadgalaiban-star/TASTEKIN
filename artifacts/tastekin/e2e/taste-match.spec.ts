import { expect, test } from '@playwright/test';

const apiBaseUrl = process.env.TASTEKIN_API_URL ?? 'http://127.0.0.1:8080';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tastekin:')) localStorage.removeItem(key);
    }
  });
  await page.goto('/');
});

test('offers Taste tuning from settings and the owner profile', async ({ page }) => {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByTestId('menu-tune-taste')).toBeVisible();
  await page.getByTestId('menu-tune-taste').click();
  await expect(page.getByRole('heading', { name: 'Tune your taste' })).toBeVisible();

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByTestId('identity-owner').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByTestId('profile-tune-taste')).toBeVisible();
  await page.getByTestId('profile-tune-taste').click();
  await expect(page.getByRole('heading', { name: 'Tune your taste' })).toBeVisible();
});

test('keeps signed-out matching private and filters verified creator discovery', async ({ request }) => {
  const signedOut = await request.get(`${apiBaseUrl}/api/taste-match/fheed`);
  expect(signedOut.ok()).toBeTruthy();
  const signedOutBody = await signedOut.json();
  expect(signedOutBody).toMatchObject({
    authenticated: false,
    match: { state: 'signed_out', score: null, sharedTastes: [] },
  });

  const fashion = await request.get(`${apiBaseUrl}/api/explore?sort=new&category=Fashion&city=Kuwait%20City`);
  expect(fashion.ok()).toBeTruthy();
  const fashionBody = await fashion.json();
  expect(fashionBody.creators).toHaveLength(1);
  expect(fashionBody.creators[0]).toMatchObject({ username: 'fheed' });

  const restaurants = await request.get(`${apiBaseUrl}/api/explore?sort=new&category=Restaurants&city=Jeddah`);
  expect(restaurants.ok()).toBeTruthy();
  const restaurantsBody = await restaurants.json();
  expect(restaurantsBody.creators).toHaveLength(1);
  expect(restaurantsBody.creators[0]).toMatchObject({ username: 'noura.studio' });
});