import { expect, test, type Page } from '@playwright/test';

// The profile section row: exactly two tabs (Edits, Collections) on both the
// owner's own profile and a visitor's view of another creator, Edits open by
// default, and a browser-history entry that still names the retired About
// screen falling back to the profile's Edits view.

const ownerProfile = {
  displayName: 'Fheed Alaiban', username: 'fheed', bio: 'A considered edit of fashion, places and travel.',
  city: 'Kuwait City', country: 'Kuwait', interests: ['Fashion', 'Travel'], avatar: '', avatarObjectPath: null,
  age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1,
};

const nouraProfile = {
  displayName: 'Noura Studio', username: 'noura.studio', bio: 'Restaurants and quiet corners of the city.',
  city: 'Kuwait City', country: 'Kuwait', interests: ['Restaurants', 'Places'], avatar: '', avatarObjectPath: null,
  age: null, dateOfBirth: null, showAge: false, verified: false, revision: 1,
};

const exploreBody = {
  authenticated: true,
  sort: 'best',
  creators: [
    { id: 'fheed-alaiban', username: 'fheed', displayName: 'Fheed Alaiban', avatar: '', categories: ['Fashion'], matchScore: null, matchReasons: [] },
    { id: 'noura-studio', username: 'noura.studio', displayName: 'Noura Studio', avatar: '', categories: ['Restaurants'], matchScore: null, matchReasons: [] },
  ],
  edits: [],
};

async function mockOwnerSession(page: Page, language: 'en' | 'ar' = 'en') {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tastekin:')) localStorage.removeItem(key);
    }
  });
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        user: { id: 'profile-tabs-user', email: 'profile-tabs@tastekin.test' },
        role: 'creator',
        language,
        creator: { id: 'fheed', handle: 'fheed', displayName: 'Fheed Alaiban', verified: true, ownsWorkspace: true },
        featureFlags: { my_circle: true },
      }),
    });
  });
  await page.route('**/api/creator-profile', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ownerProfile) });
  });
  await page.route('**/api/creator-workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ creatorId: 'fheed', revision: 1, edits: [], collections: [] }) });
  });
  await page.route('**/api/creator-featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) });
  });
  await page.route('**/api/creators/noura.studio/profile', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(nouraProfile) });
  });
  await page.route('**/api/creators/noura.studio/workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ edits: [], collections: [] }) });
  });
  await page.route('**/api/creators/noura.studio/featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) });
  });
  await page.route('**/api/creators/noura.studio/views', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/explore**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(exploreBody) });
  });
}

async function openOwnProfile(page: Page) {
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
}

async function openVisitorProfile(page: Page) {
  await page.getByTestId('nav-explore').click();
  await page.getByTestId('creator-noura.studio').click();
  await expect(page.getByRole('heading', { name: 'Noura Studio' })).toBeVisible();
}

// The section row must be a single grid of two equal halves; each label
// centered in its half; the active underline (the ::after pseudo-element)
// inset within its own tab's half — never spanning the row or sitting under
// the other tab.
async function expectTwoEqualTabs(page: Page, labels: [string, string], activeIndex: 0 | 1) {
  const row = page.getByTestId('profile-section-tabs');
  await expect(row).toBeVisible();
  const buttons = row.locator('button');
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toHaveText(labels[0]);
  await expect(buttons.nth(1)).toHaveText(labels[1]);
  await expect(buttons.nth(activeIndex)).toHaveClass(/active/);
  await expect(buttons.nth(activeIndex === 0 ? 1 : 0)).not.toHaveClass(/active/);

  const layout = await row.evaluate((element, active) => {
    const rowBox = element.getBoundingClientRect();
    const tabs = Array.from(element.querySelectorAll('button')).map((button) => {
      const box = button.getBoundingClientRect();
      const label = getComputedStyle(button);
      return { left: box.left, right: box.right, width: box.width, textAlign: label.textAlign, justifyContent: label.justifyContent, display: label.display };
    });
    const activeTab = element.querySelectorAll('button')[active];
    const underline = getComputedStyle(activeTab, '::after');
    const activeBox = activeTab.getBoundingClientRect();
    return {
      rowLeft: rowBox.left, rowRight: rowBox.right, rowWidth: rowBox.width,
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      tabs,
      underline: {
        content: underline.content,
        height: parseFloat(underline.height),
        left: parseFloat(underline.left), right: parseFloat(underline.right),
        position: underline.position,
      },
      activeBox: { left: activeBox.left, right: activeBox.right, width: activeBox.width },
    };
  }, activeIndex);

  expect(layout.columns).toBe(2);
  expect(layout.tabs).toHaveLength(2);
  expect(Math.abs(layout.tabs[0].width - layout.tabs[1].width)).toBeLessThan(1);
  expect(Math.abs(layout.tabs[0].width - layout.rowWidth / 2)).toBeLessThan(1);
  // The two halves tile the row exactly: one starts where the row starts,
  // the other ends where it ends, and they meet in the middle.
  const sorted = [...layout.tabs].sort((a, b) => a.left - b.left);
  expect(Math.abs(sorted[0].left - layout.rowLeft)).toBeLessThan(1);
  expect(Math.abs(sorted[1].right - layout.rowRight)).toBeLessThan(1);
  expect(Math.abs(sorted[0].right - sorted[1].left)).toBeLessThan(1);
  // Labels are centered in their half whether the tab lays out as a flex
  // box (the profile's own row) or as a plain block (the Collections screen).
  for (const tab of layout.tabs) {
    expect(tab.display === 'flex' ? tab.justifyContent : tab.textAlign).toBe('center');
  }
  // Underline: a 3px bar absolutely positioned inside the active tab, inset
  // 8px from each of that tab's own edges — so it is centered under the
  // active label and never crosses into the other half.
  expect(layout.underline.content).not.toBe('none');
  expect(layout.underline.position).toBe('absolute');
  expect(layout.underline.height).toBeCloseTo(3, 1);
  expect(layout.underline.left).toBeCloseTo(8, 1);
  expect(layout.underline.right).toBeCloseTo(8, 1);
}

test.describe('English', () => {
  test.beforeEach(async ({ page }) => {
    await mockOwnerSession(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('the owner profile shows only Edits and Collections, Edits open by default, with the bio still in the header', async ({ page }) => {
    await openOwnProfile(page);
    await expectTwoEqualTabs(page, ['Edits', 'Collections'], 0);
    await expect(page.getByTestId('profile-section-tabs').getByRole('button', { name: 'About' })).toHaveCount(0);
    await expect(page.locator('.profile-bio')).toHaveText(ownerProfile.bio);
    await expect(page.getByTestId('profile-edits-grid')).toBeVisible();
  });

  test('a visitor viewing another creator sees the same two tabs and the bio in the header', async ({ page }) => {
    await openVisitorProfile(page);
    await expectTwoEqualTabs(page, ['Edits', 'Collections'], 0);
    await expect(page.getByTestId('profile-section-tabs').getByRole('button', { name: 'About' })).toHaveCount(0);
    await expect(page.locator('.profile-bio')).toHaveText(nouraProfile.bio);
  });

  test('the Collections tab opens the Collections screen with the same two-tab row, and Edits returns to the profile', async ({ page }) => {
    await openOwnProfile(page);
    await page.getByTestId('profile-tab-collections').click();
    await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
    await expectTwoEqualTabs(page, ['Edits', 'Collections'], 1);
    await expect(page.getByTestId('profile-section-tabs').getByRole('button', { name: 'About' })).toHaveCount(0);

    await page.getByTestId('profile-tab-edits').click();
    await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
    await expectTwoEqualTabs(page, ['Edits', 'Collections'], 0);
  });

  test('a history entry saved for the retired About screen restores the profile on its Edits tab', async ({ page }) => {
    await openOwnProfile(page);
    await page.getByTestId('profile-tab-collections').click();
    await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();

    // Simulate the browser holding an entry an older build recorded for the
    // About screen, with a later entry on top of it, then Back into it.
    await page.evaluate(() => {
      window.history.pushState({ screen: 'about' }, '');
      window.history.pushState({ screen: 'settings' }, '');
    });
    await page.goBack();

    await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
    await expectTwoEqualTabs(page, ['Edits', 'Collections'], 0);
    await expect(page.getByText('Taste pillars')).toHaveCount(0);
    await expect(page.locator('.profile-bio')).toHaveText(ownerProfile.bio);
  });

  test('a history entry naming an unknown screen falls back to Home instead of a blank page', async ({ page }) => {
    await openOwnProfile(page);
    await page.evaluate(() => {
      window.history.pushState({ screen: 'no-such-screen' }, '');
      window.history.pushState({ screen: 'settings' }, '');
    });
    await page.goBack();
    await expect(page.getByTestId('primary-navigation')).toBeVisible();
    await expect(page.getByTestId('nav-home')).toHaveClass(/active/);
  });
});

test.describe('Arabic', () => {
  test.beforeEach(async ({ page }) => {
    await mockOwnerSession(page, 'ar');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
  });

  test('shows only التعديلات and المجموعات, equal width and centered, in RTL', async ({ page }) => {
    await page.getByTestId('nav-you').click();
    await page.getByRole('button', { name: 'عرض الملف' }).click();
    await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
    await expectTwoEqualTabs(page, ['التعديلات', 'المجموعات'], 0);
    await expect(page.getByTestId('profile-section-tabs').getByRole('button', { name: 'حول' })).toHaveCount(0);
    await expect(page.locator('.profile-bio')).toHaveText(ownerProfile.bio);

    await page.getByTestId('profile-tab-collections').click();
    await expect(page.getByRole('heading', { name: 'المجموعات' })).toBeVisible();
    await expectTwoEqualTabs(page, ['التعديلات', 'المجموعات'], 1);
  });
});
