import { expect, test } from '@playwright/test';

// Sign-up → onboarding step 1 against the REAL API, with no route mocks.
//
// The mocked onboarding spec cannot see a drift between the web app's save
// body and the API's schema (that is how every production sign-up ended up
// stuck on "Invalid creator profile"). This spec drives the real UI against
// the compiled api-server and a disposable database, so the body the app
// actually sends is validated by the real server.
//
// It is skipped unless TASTEKIN_LIVE_API=1, because the default e2e run has
// no API behind it. Run it through the runner, which builds nothing and
// starts the server for you:
//
//   DATABASE_URL=postgresql://<disposable> pnpm --filter scripts run verify:onboarding-live
//
// (after `pnpm --filter @workspace/tastekin run build` and
// `pnpm --filter @workspace/api-server run build`).

test.skip(!process.env.TASTEKIN_LIVE_API, 'needs the real API: run via `pnpm --filter scripts run verify:onboarding-live`');

test('a brand-new email/password account gets through onboarding step 1 on the real API', async ({ page }) => {
  test.setTimeout(60_000);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `live-${stamp}@example.test`;
  const handle = `live_${stamp}`.slice(0, 30);

  await page.goto('/');
  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-sign-in').click();
  await page.getByRole('button', { name: "Don't have an account? Sign up" }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('live-onboarding-pass-1');
  await page.getByTestId('signup-terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  // A fresh account lands on onboarding with the auto-created profile.
  await expect(page.getByTestId('onboarding-basics')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByPlaceholder('yourname')).toHaveValue(/^live_/);

  // Step 1: the body the app sends must be accepted by the real server.
  await page.getByPlaceholder('Your name').fill('Live Member');
  await page.getByPlaceholder('yourname').fill(handle);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('onboarding-photo')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Steps 2 and 3 are optional; skipping them exercises the advance route.
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByTestId('onboarding-city')).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByTestId('onboarding-taste')).toBeVisible();

  // The server now holds what the form sent.
  const profile = await page.evaluate(() => fetch('/api/creator-profile', { credentials: 'include', cache: 'no-store' }).then((r) => r.json()));
  expect(profile).toMatchObject({ displayName: 'Live Member', username: handle, coverImageObjectPath: null });
});

test('a username with invalid characters is refused by the real API with the specific message', async ({ page }) => {
  test.setTimeout(60_000);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto('/');
  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-sign-in').click();
  await page.getByRole('button', { name: "Don't have an account? Sign up" }).click();
  await page.getByLabel('Email').fill(`live-bad-${stamp}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('live-onboarding-pass-1');
  await page.getByTestId('signup-terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('onboarding-basics')).toBeVisible({ timeout: 20_000 });

  // The form itself lowercases and strips invalid characters, so send a bad
  // value straight to the API as the app would if that guard ever slipped.
  const refused = await page.evaluate(async () => {
    const current = await fetch('/api/creator-profile', { credentials: 'include', cache: 'no-store' }).then((r) => r.json());
    const response = await fetch('/api/creator-profile', {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Live Member', username: 'Review', bio: current.bio, city: current.city, country: current.country, interests: current.interests, dateOfBirth: current.dateOfBirth, showAge: current.showAge, avatarObjectPath: current.avatarObjectPath, coverImageObjectPath: current.coverImageObjectPath }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toBe('Username must be 3-30 characters: lowercase letters, numbers, or underscores.');
});
