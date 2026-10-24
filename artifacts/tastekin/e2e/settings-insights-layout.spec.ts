import { expect, test, type Page } from '@playwright/test';

// Two layout fixes:
//  - Settings buttons with an icon (Blocked accounts, Muted accounts, Support
//    page, Privacy Policy, Terms, Sign out, Delete account): icon and label
//    on one line, centred, in LTR and RTL;
//  - Insights Edit titles wrap on word boundaries and clamp to two lines
//    instead of being cut mid-word.

async function ownerSession(page: Page, language: 'en' | 'ar' = 'en') {
  await page.route('**/api/me', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      user: { id: 'owner', email: 'owner@tastekin.test' }, role: 'creator',
      creator: { id: 'owner', handle: 'owner', displayName: 'Owner', verified: true, ownsWorkspace: true },
      isAdmin: false, language, notifyPush: true, notifyEmail: true, supportEmail: null,
      needsOnboarding: false, onboardingStep: 'done', googleAuthConfigured: false, featureFlags: {},
    }),
  }));
  await page.route('**/api/creator-profile', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ displayName: 'Owner', username: 'owner', bio: '', city: '', country: '', interests: [], tasteTags: [], avatar: '', avatarObjectPath: null, coverImage: '', coverImageObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1 }),
  }));
  const longTitle = 'A long dinner with friends at the new agave bar downtown, then dessert somewhere quieter';
  await page.route('**/api/creator-workspace', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ creatorId: 'owner', revision: 1, edits: [{ id: 'e1', category: 'Restaurants', title: longTitle, titleAr: 'عشاء طويل مع الأصدقاء في مطعم الأغاف الجديد وسط المدينة ثم حلويات في مكان أهدأ', caption: '', captionAr: '', image: '/tastekin-media/quiet-tailoring.webp', location: '', locationAr: '', altText: '', access: 'public', status: 'published', collectionIds: [] }], collections: [] }) }));
  await page.route('**/api/creator-featured-collections', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) }));
  await page.route('**/api/creator-insights', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ profileViews: 4, totalLikes: 1, totalSaves: 0, totalComments: 0, edits: [{ editId: 'e1', likes: 1, saves: 0, comments: 0, views: 4 }] }) }));
}

const SETTINGS_ICON_BUTTONS = ['settings-blocked-accounts', 'settings-muted-accounts', 'settings-support-page', 'settings-privacy', 'settings-terms', 'settings-sign-out', 'settings-delete-account'];

for (const language of ['en', 'ar'] as const) {
  test(`Settings icon buttons keep icon and label on one line (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ownerSession(page, language);
    await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('open-settings-topbar').click();
    for (const id of SETTINGS_ICON_BUTTONS) {
      const button = page.getByTestId(id);
      await button.scrollIntoViewIfNeeded();
      const boxes = await button.evaluate((element) => {
        const svg = element.querySelector('svg')!;
        const range = document.createRange();
        const text = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
        range.selectNodeContents(text!);
        const t = range.getBoundingClientRect();
        const s = svg.getBoundingClientRect();
        const b = element.getBoundingClientRect();
        return { icon: { x: s.left, right: s.right, cy: s.top + s.height / 2 }, text: { x: t.left, right: t.right, cy: t.top + t.height / 2 }, button: { cy: b.top + b.height / 2, height: b.height } };
      });
      // Same line: both centres within a few px of the button's centre.
      expect(Math.abs(boxes.icon.cy - boxes.button.cy), `${id} icon vertically centred`).toBeLessThan(6);
      expect(Math.abs(boxes.text.cy - boxes.button.cy), `${id} label vertically centred`).toBeLessThan(6);
      // Beside, not above: icon leads the label in LTR, trails it in RTL.
      if (language === 'ar') expect(boxes.icon.x, `${id} icon after label in RTL`).toBeGreaterThanOrEqual(boxes.text.right - 1);
      else expect(boxes.icon.right, `${id} icon before label in LTR`).toBeLessThanOrEqual(boxes.text.x + 1);
      expect(boxes.button.height, `${id} single-line height`).toBeLessThan(60);
    }
    await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
  });

  test(`Insights titles wrap on word boundaries and clamp to two lines (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ownerSession(page, language);
    await page.goto(language === 'ar' ? '/?lang=ar' : '/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-you').click();
    await page.getByRole('button', { name: language === 'ar' ? 'عرض الملف' : 'View profile' }).click();
    await page.getByRole('button', { name: language === 'ar' ? 'الإحصاءات' : 'Insights' }).click();
    const title = page.locator('.insight-edit-list article strong').first();
    await expect(title).toBeVisible();
    const metrics = await title.evaluate((element) => {
      const style = getComputedStyle(element);
      const lineHeight = parseFloat(style.lineHeight);
      return { clamp: style.webkitLineClamp, whiteSpace: style.whiteSpace, lines: Math.round(element.getBoundingClientRect().height / lineHeight), clipped: element.scrollWidth > element.clientWidth + 1 };
    });
    expect(metrics.whiteSpace).toBe('normal');
    expect(metrics.clamp).toBe('2');
    expect(metrics.lines).toBe(2);
    expect(metrics.clipped, 'no horizontal mid-word clipping').toBe(false);
  });
}
