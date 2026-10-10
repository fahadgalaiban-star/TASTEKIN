import { expect, test, type Page } from '@playwright/test';

// Store-readiness layout check across the phone and tablet sizes Apple and
// Google review on. The app is a centred column (`.approved-shell`,
// width:min(100%,440px)) with a fixed bottom nav, so the things that can go
// wrong on a wider or narrower screen are: horizontal overflow, the bottom
// nav or top bar escaping the shell column, and controls landing outside the
// viewport. /api/me is mocked (guest or member); every other API answers 503
// so the chrome, error/empty states, auth, settings and legal pages render
// without a server — those are exactly the surfaces a reviewer reaches first.

const VIEWPORTS = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 15', width: 393, height: 852 },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932 },
  { name: 'iPad mini portrait', width: 744, height: 1133 },
  { name: 'iPad 10.9 portrait', width: 820, height: 1180 },
  { name: 'iPad 10.9 landscape', width: 1180, height: 820 },
  { name: 'iPad Pro 12.9 portrait', width: 1024, height: 1366 },
] as const;

function mePayload(authenticated: boolean, language: 'en' | 'ar') {
  const base = {
    role: 'consumer', creator: null, isAdmin: false, notifyPush: true, notifyEmail: true, supportEmail: 'help@example.test',
    passwordResetAvailable: false, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: {},
  };
  return authenticated
    ? { ...base, user: { id: 'layout-user', email: 'member@tastekin.test' }, language, authProvider: 'password' }
    : { ...base, user: null, language: null };
}

// A signed-in member's language comes from the account (the server's
// `language`), not from `?lang=`, so the Arabic member pass mocks it there.
async function mockSession(page: Page, authenticated: boolean, language: 'en' | 'ar' = 'en') {
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Unmocked test endpoint' }) }));
  await page.route('**/api/me', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(mePayload(authenticated, language)) }));
}

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string): Box | null => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerHeight: window.innerHeight,
      shell: box('.approved-shell'),
      topbar: box('.approved-topbar'),
      nav: box('.approved-nav'),
      logo: box('.approved-logo'),
    };
  });
}

async function expectNoOverflowAndChromeInside(page: Page, width: number, height: number, screen: string) {
  const m = await measure(page);
  const label = `${screen} @ ${width}x${height}`;
  expect(m.scrollWidth, `${label}: horizontal overflow`).toBeLessThanOrEqual(m.clientWidth);
  expect(m.bodyScrollWidth, `${label}: body overflow`).toBeLessThanOrEqual(m.clientWidth);
  expect(m.shell, `${label}: shell missing`).not.toBeNull();
  const shell = m.shell!;
  // The column never exceeds its design width and is centred on wide screens.
  expect(shell.width).toBeLessThanOrEqual(440.5);
  expect(shell.left).toBeGreaterThanOrEqual(-0.5);
  expect(shell.right).toBeLessThanOrEqual(m.clientWidth + 0.5);
  if (m.clientWidth > 600) expect(Math.abs((m.clientWidth - shell.right) - shell.left), `${label}: shell not centred`).toBeLessThan(2);
  if (m.topbar) {
    expect(m.topbar.left, `${label}: top bar left of shell`).toBeGreaterThanOrEqual(shell.left - 0.5);
    expect(m.topbar.right, `${label}: top bar right of shell`).toBeLessThanOrEqual(shell.right + 0.5);
  }
  if (m.logo) {
    expect(m.logo.left).toBeGreaterThanOrEqual(shell.left);
    expect(m.logo.right).toBeLessThanOrEqual(shell.right);
  }
  if (m.nav) {
    // Fixed bottom nav: inside the viewport vertically and inside the column horizontally.
    expect(m.nav.bottom, `${label}: nav below viewport`).toBeLessThanOrEqual(m.innerHeight + 0.5);
    expect(m.nav.top, `${label}: nav above viewport`).toBeGreaterThanOrEqual(0);
    expect(m.nav.left, `${label}: nav left of shell`).toBeGreaterThanOrEqual(shell.left - 0.5);
    expect(m.nav.right, `${label}: nav right of shell`).toBeLessThanOrEqual(shell.right + 0.5);
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('guest surfaces: home, explore, saved, sign-in, forgot password, support, privacy, terms, delete-account', async ({ page }) => {
      await mockSession(page, false);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.approved-shell')).toBeVisible();
      await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, 'home');

      await page.getByTestId('nav-explore').click();
      await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, 'explore');
      await page.getByTestId('nav-saved').click();
      await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, 'saved');

      await page.getByTestId('nav-you').click();
      await page.getByTestId('you-sign-in').click();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, 'sign-in');
      await page.getByRole('button', { name: 'Forgot password?' }).click();
      await expect(page.getByTestId('forgot-password-unavailable')).toBeVisible();
      await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, 'forgot-password');

      for (const path of ['/support', '/privacy', '/terms', '/delete-account']) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.approved-shell')).toBeVisible();
        await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, path);
        // Long legal text must wrap inside the column, including at the bottom of the page.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, `${path} (scrolled)`);
      }
    });

    test('member surfaces: settings (EN and AR/RTL) stay inside the column', async ({ page }) => {
      await mockSession(page, true);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.getByTestId('open-settings-topbar').click();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, 'settings');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, 'settings (scrolled)');

      await mockSession(page, true, 'ar');
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, 'home (ar)');
      await page.getByTestId('open-settings-topbar').click();
      await expectNoOverflowAndChromeInside(page, viewport.width, viewport.height, 'settings (ar)');
    });
  });
}
