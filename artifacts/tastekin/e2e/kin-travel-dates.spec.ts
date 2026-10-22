import { expect, test, type Page } from '@playwright/test';

// KIN Travel step 1: the Start / End (optional) date fields must fit inside
// an iPhone-width screen side by side, in LTR and RTL, with no horizontal
// page scroll. (iOS Safari gives <input type=date> a wide intrinsic width,
// which used to push the End field past the right edge.)

async function mockMe(page: Page, language: 'en' | 'ar') {
  await page.route('**/api/me', async (route) => route.fulfill({
    contentType: 'application/json', headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      user: { id: 'kin-e2e-user', email: 'kin-e2e@tastekin.test' }, role: 'consumer', creator: null, isAdmin: false, language,
      notifyPush: true, notifyEmail: true, supportEmail: null, needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false,
      featureFlags: { kin_search: true, kin_looks: true },
    }),
  }));
}

for (const language of ['en', 'ar'] as const) {
  test(`Start and End date fields fit within 390px side by side (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockMe(page, language);
    await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-kin').click();
    await page.getByTestId('kin-mode-travel').click();
    await expect(page.getByTestId('kin-travel-step')).toHaveAttribute('data-step', '1');
    await expect(page.getByText(language === 'ar' ? 'النهاية (اختياري)' : 'End (optional)')).toBeVisible();

    const start = await page.getByTestId('kin-start-date').boundingBox();
    const end = await page.getByTestId('kin-end-date').boundingBox();
    expect(start && end).toBeTruthy();
    for (const box of [start!, end!]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.width).toBeGreaterThan(120);
    }
    // Side by side on one row, not stacked or overlapping.
    expect(Math.abs(start!.y - end!.y)).toBeLessThan(2);
    const [first, second] = language === 'ar' ? [end!, start!] : [start!, end!];
    expect(first.x + first.width).toBeLessThanOrEqual(second.x + 1);
    await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
  });
}
