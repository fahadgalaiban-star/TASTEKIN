import { expect, test, type Page } from '@playwright/test';

// KIN mode bar with the kin_looks flag at its default (off): Style and the
// My Things shortcut are hidden, Travel is the only option, centred and sized
// to its label rather than stretched across the column, and the screen opens
// on Travel step 1. With kin_looks on, the previous three-tab bar is back.
// The Travel flow itself is untouched: this only covers the bar.

type Flags = Record<string, boolean>;

function meBody(language: 'en' | 'ar', featureFlags: Flags) {
  return JSON.stringify({
    user: { id: 'kin-travel-only-user', email: 'kin-travel-only@tastekin.test' },
    role: 'consumer', creator: null, isAdmin: false, language, notifyPush: true, notifyEmail: true, supportEmail: null,
    passwordResetAvailable: false, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags,
  });
}

async function openKin(page: Page, language: 'en' | 'ar', featureFlags: Flags) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Unmocked test endpoint' }) }));
  await page.route('**/api/me', (route) => route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody(language, featureFlags) }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-screen')).toBeVisible();
}

async function measureTravelPill(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`missing ${selector}`);
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    };
    return { shell: rect('.approved-shell'), bar: rect('[data-testid="kin-mode-toggle"]'), pill: rect('[data-testid="kin-mode-travel"]'), scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  });
}

for (const viewport of [{ name: 'iPhone SE', width: 375, height: 667 }, { name: 'iPhone 15', width: 393, height: 852 }, { name: 'iPhone 15 Pro Max', width: 430, height: 932 }]) {
  test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const language of ['en', 'ar'] as const) {
      test(`kin_looks off: Travel alone, centred, label-sized, opens on Travel step 1 (${language})`, async ({ page }) => {
        await openKin(page, language, { kin_search: true, my_things: true });
        if (language === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

        await expect(page.getByTestId('kin-mode-looks')).toHaveCount(0);
        await expect(page.getByTestId('kin-mode-my-things')).toHaveCount(0);
        const travel = page.getByTestId('kin-mode-travel');
        await expect(travel).toBeVisible();
        await expect(travel).toHaveText(language === 'ar' ? 'السفر' : 'Travel');
        await expect(travel).toHaveClass(/selected/);
        await expect(page.getByTestId('kin-mode-toggle').locator('button')).toHaveCount(1);
        await expect(page.getByTestId('kin-travel-step')).toHaveAttribute('data-step', '1');

        const m = await measureTravelPill(page);
        expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
        // Centred in the column, within a pixel either side.
        const leftGap = m.pill.left - m.shell.left;
        const rightGap = m.shell.right - m.pill.right;
        expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
        // Sized to its label (comfortably tappable), never stretched across the column.
        expect(m.pill.width).toBeGreaterThanOrEqual(150);
        expect(m.pill.width).toBeLessThan(m.shell.width * 0.7);
        expect(m.bar.width).toBeLessThan(m.shell.width * 0.75);
        expect(m.pill.height).toBeGreaterThanOrEqual(44);
      });
    }

    test('kin_looks on: the Style | My Things | Travel bar is back and Style is the default', async ({ page }) => {
      await openKin(page, 'en', { kin_search: true, my_things: true, kin_looks: true });
      await expect(page.getByTestId('kin-mode-looks')).toBeVisible();
      await expect(page.getByTestId('kin-mode-looks')).toHaveClass(/selected/);
      await expect(page.getByTestId('kin-mode-my-things')).toBeVisible();
      await expect(page.getByTestId('kin-mode-travel')).toBeVisible();
      await expect(page.getByTestId('kin-mode-toggle').locator('button')).toHaveCount(3);
      await expect(page.getByTestId('kin-mode-toggle')).not.toHaveClass(/kin-segmented-single/);
    });
  });
}

test('tapping Travel in the single bar keeps Travel on step 1 and never reveals Style', async ({ page }) => {
  await openKin(page, 'en', { kin_search: true });
  await page.getByTestId('kin-mode-travel').click();
  await expect(page.getByTestId('kin-travel-step')).toHaveAttribute('data-step', '1');
  await expect(page.getByTestId('kin-mode-looks')).toHaveCount(0);
  await expect(page.getByTestId('kin-mode-toggle').locator('button')).toHaveCount(1);
});
