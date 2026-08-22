import { expect, test } from '@playwright/test';

test('revalidates the shared founder session after a magic-link return, navigation, and refresh', async ({ page }) => {
  let signedIn = false;

  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      body: JSON.stringify(signedIn
        ? {
          user: { id: 'fheed-founder', email: 'founder@tastekin.test' },
          role: 'creator',
          creator: { handle: 'fheed', displayName: 'Fheed Alaiban', verified: true, ownsWorkspace: true },
        }
        : { user: null, role: 'consumer', creator: null }),
    });
  });
  await page.route('**/api/explore**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      body: JSON.stringify({
        authenticated: signedIn,
        sort: 'best',
        creators: [{
          id: 'noura-studio',
          username: 'noura.studio',
          displayName: 'Noura Studio',
          avatar: '/tastekin-media/fheed-profile.webp',
          categories: ['Restaurants', 'Places'],
          matchScore: signedIn ? 76 : null,
          matchReasons: signedIn ? ['Shared tastes: places and considered travel.'] : [],
        }],
        edits: [],
        collections: [],
        places: [],
        products: [],
      }),
    });
  });

  await page.goto('/');
  await page.getByTestId('nav-explore').click();
  await expect(page.getByText('Sign in to see personalized Best Matches.')).toBeVisible();

  // The OIDC callback has set the same browser session cookie before returning to the app.
  signedIn = true;
  await page.getByTestId('nav-you').click();
  await expect(page.getByRole('button', { name: 'View profile' })).toBeVisible();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();

  await page.getByTestId('nav-explore').click();
  await expect(page.getByText('Sign in to see personalized Best Matches.')).toHaveCount(0);
  await expect(page.getByText('76%')).toBeVisible();

  await page.reload();
  await page.getByTestId('nav-you').click();
  await expect(page.getByRole('button', { name: 'View profile' })).toBeVisible();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
  await page.getByTestId('nav-explore').click();
  await expect(page.getByText('Sign in to see personalized Best Matches.')).toHaveCount(0);
  await expect(page.getByText('76%')).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
});