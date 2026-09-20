import { expect, test, type Page } from '@playwright/test';

async function openConsumerProfile(page: Page) {
  await page.getByTestId('nav-explore').click();
  await expect(page.getByRole('heading', { name: 'Find your next taste.' })).toBeVisible();
  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
}

async function expectVisitorActionsAt390(page: Page) {
  const layout = await page.locator('.profile-visitor-actions').evaluate((row) => {
    const box = (element: Element | null) => {
      if (!element) throw new Error('Missing visitor Profile control');
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const controls = [
      box(row.querySelector('[data-testid="profile-follow-action"]')),
      box(row.querySelector('[data-testid="profile-message-action"]')),
      box(row.querySelector('[data-testid="profile-circle-action"]')),
      box(row.querySelector('.report-trigger')),
    ].sort((a, b) => a.left - b.left);
    const identity = box(document.querySelector('.profile-head-copy'));
    return {
      row: box(row),
      follow: box(row.querySelector('[data-testid="profile-follow-action"]')),
      message: box(row.querySelector('[data-testid="profile-message-action"]')),
      circle: box(row.querySelector('[data-testid="profile-circle-action"]')),
      identity,
      gaps: controls.slice(1).map((control, index) => control.left - controls[index].right),
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(layout.viewportWidth).toBe(390);
  expect(layout.scrollWidth).toBe(390);
  expect(layout.follow.width).toBeCloseTo(76, 1);
  expect(layout.follow.height).toBeCloseTo(48, 1);
  expect(layout.message.width).toBeCloseTo(92, 1);
  expect(layout.message.height).toBeCloseTo(48, 1);
  expect(layout.circle.width).toBeCloseTo(48, 1);
  expect(layout.circle.height).toBeCloseTo(48, 1);
  expect(layout.gaps.every((gap) => Math.abs(gap - 6) < 0.75)).toBe(true);
  expect(layout.row.left).toBeGreaterThanOrEqual(16);
  expect(layout.row.right).toBeLessThanOrEqual(374);
  expect(layout.row.top).toBeGreaterThanOrEqual(layout.identity.bottom);
}

const quietTailoringFeed = {
  id: 'quiet-tailoring',
  category: 'Fashion',
  title: 'Quiet tailoring',
  titleAr: 'أناقة هادئة',
  caption: 'A soft-structured look for a long city day.',
  captionAr: 'إطلالة مريحة ومنسّقة ليوم طويل في المدينة.',
  image: '/tastekin-media/quiet-tailoring.webp',
  location: 'Mayfair, London',
  locationAr: 'مايفير، لندن',
  altText: 'Tailoring.',
  access: 'public',
  status: 'published',
  collectionIds: [],
};

const privateHotelFeed = {
  id: 'private-hotel',
  category: 'Travel',
  title: 'Private hotel weekend',
  titleAr: 'عطلة فندقية خاصة',
  caption: 'The stay, the packing list, and where I ate.',
  captionAr: 'الإقامة، قائمة الحقائب، والأماكن التي تناولت فيها الطعام.',
  image: '/tastekin-media/private-hotel-preview.webp',
  location: 'Kuwait City, Kuwait',
  locationAr: 'مدينة الكويت، الكويت',
  altText: 'Private hotel preview.',
  access: 'locked',
  status: 'published',
  collectionIds: ['coastal-edit'],
};

test.beforeEach(async ({ page }) => {
  const savedEditIds = new Set<string>();
  const savedLists: Array<{ id: string; name: string; editIds: string[]; createdAt: string; updatedAt: string }> = [];
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tastekin:')) localStorage.removeItem(key);
    }
  });
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      body: JSON.stringify({
        user: { id: 'fheed-founder', email: 'founder@tastekin.test' },
        role: 'creator',
        creator: { id: 'fheed', handle: 'fheed', displayName: 'Fheed Alaiban', verified: true, ownsWorkspace: true },
        featureFlags: { my_circle: true },
      }),
    });
  });
  await page.route('**/api/me/saved-edits', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([...savedEditIds]) });
  });
  await page.route('**/api/me/saved-lists', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string };
      const now = new Date().toISOString();
      const list = { id: `list-${savedLists.length + 1}`, name: body.name, editIds: [], createdAt: now, updatedAt: now };
      savedLists.push(list);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(list) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(savedLists) });
  });
  await page.route('**/api/me/saved-lists/*/edits/*', async (route) => {
    const segments = new URL(route.request().url()).pathname.split('/');
    const list = savedLists.find((item) => item.id === segments[4]);
    const editId = segments[6];
    const body = route.request().postDataJSON() as { active: boolean };
    if (list) list.editIds = body.active ? Array.from(new Set([...list.editIds, editId])) : list.editIds.filter((id) => id !== editId);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ listId: list?.id, editId, active: body.active }) });
  });
  await page.route('**/api/me/saved-lists/*', async (route) => {
    const listId = new URL(route.request().url()).pathname.split('/')[4];
    const index = savedLists.findIndex((item) => item.id === listId);
    if (route.request().method() === 'PUT' && index >= 0) {
      const body = route.request().postDataJSON() as { name: string };
      savedLists[index] = { ...savedLists[index], name: body.name, updatedAt: new Date().toISOString() };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(savedLists[index]) });
      return;
    }
    if (route.request().method() === 'DELETE' && index >= 0) {
      savedLists.splice(index, 1);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  await page.route('**/api/edits/**/save', async (route) => {
    const editId = new URL(route.request().url()).pathname.split('/')[3];
    const body = route.request().postDataJSON() as { active?: boolean };
    if (body.active) savedEditIds.add(editId);
    else savedEditIds.delete(editId);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ editId, likeCount: 0, commentCount: 0, liked: false, saved: body.active === true }),
    });
  });
  await page.route('**/api/relationships/follow/**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ following: false }) });
  });
  await page.route('**/api/relationships', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ active: true }) });
  });
  await page.route('**/api/creator-workspace', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        creatorId: 'fheed',
        revision: 1,
        edits: [
          { ...quietTailoringFeed, collectionIds: ['quiet-luxury'] },
          privateHotelFeed,
        ],
        collections: [
          { id: 'quiet-luxury', title: 'Quiet Luxury', titleAr: 'فخامة هادئة', description: 'Tailoring, materials, and a quieter way to dress.', descriptionAr: 'تفصيل وخامات وطريقة أكثر هدوءاً في ارتداء الملابس.', access: 'public', coverEditId: 'quiet-tailoring', editIds: ['quiet-tailoring'] },
          { id: 'coastal-edit', title: 'The Coastal Edit', titleAr: 'اختيارات الساحل', description: 'Places, packing and private travel notes.', descriptionAr: 'أماكن وحقائب وملاحظات سفر خاصة.', access: 'locked', coverEditId: 'private-hotel', editIds: ['private-hotel'] },
        ],
      }),
    });
  });
  await page.route('**/api/creator-featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: ['quiet-luxury', 'coastal-edit'] }) });
  });
  await page.route('**/api/creator-profile', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        displayName: 'Fheed Alaiban', username: 'fheed', bio: 'A considered edit of fashion, places, travel, and the rituals that make everyday life feel better.',
        city: 'Kuwait City', country: 'Kuwait', interests: ['Fashion', 'Travel', 'Places'], avatar: '/tastekin-media/fheed-profile.webp',
        avatarObjectPath: null, age: 34, dateOfBirth: '1992-01-01', showAge: true, verified: true, revision: 1,
      }),
    });
  });
  await page.route('**/api/creators/noura.studio/profile', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        displayName: 'Noura Studio', username: 'noura.studio', bio: '', city: 'Kuwait City', country: 'Kuwait', interests: ['Restaurants', 'Places'],
        avatar: '', avatarObjectPath: null, age: 31, dateOfBirth: '1995-01-01', showAge: true, verified: false, revision: 1,
      }),
    });
  });
  await page.route('**/api/creators/noura.studio/workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ edits: [], collections: [] }) });
  });
  await page.route('**/api/creators/noura.studio/featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: [] }) });
  });
  await page.goto('/');
});

test('keeps the five mobile destinations, Explore search and sort, and RTL available', async ({ page }) => {
  const navigation = page.getByTestId('primary-navigation');

  await expect(navigation.getByRole('button')).toHaveCount(5);
  await expect(navigation).toContainText('Home');
  await expect(navigation).toContainText('Explore');
  await expect(navigation).toContainText('KIN');
  await expect(navigation).toContainText('Saved');
  await expect(navigation).toContainText('You');

  await expect(page.getByTestId('home-tab-for-you')).toHaveClass(/active/);
  await expect(page.getByTestId('home-tab-following')).toBeVisible();
  await expect(page.getByTestId('home-tab-my-circle')).toBeVisible();
  await expect(page.getByTestId('home-tab-subscribed')).toHaveCount(0);
  await expect(page.getByTestId('category-All')).toHaveCount(0);
  await page.getByTestId('home-tab-following').click();
  await expect(page.getByText('No edits from people you follow yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Explore creators' }).click();

  await page.getByTestId('nav-explore').click();
  await expect(page.getByRole('heading', { name: 'Find your next taste.' })).toBeVisible();
  await expect(page.getByLabel('Search')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Best Match' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible();
  await expect(page.locator('[data-testid^="category-"]')).toHaveCount(0);
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-creator-workspace').click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed Alaiban.' })).toBeVisible();
  await page.getByTestId('nav-saved').click();
  await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible();
  await page.getByTestId('nav-you').click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await page.getByTestId('nav-explore').click();

  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-language-ar').click();
  await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
  await expect(navigation).toBeVisible();
  await expect(navigation).toContainText('الرئيسية');
  await expect(navigation).toContainText('اكتشف');
  await expect(navigation).toContainText('كين');
  await expect(navigation).toContainText('المحفوظات');
  await expect(navigation).toContainText('أنت');

  await page.getByTestId('settings-language-en').click();
  await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'ltr');
});

test('renders the default creator feed and the owner profile travel layout without stale category filters', async ({ page }) => {
  await page.route('**/api/public-feed', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          creatorUsername: 'fheed',
          creatorName: 'Fheed Alaiban',
          creatorVerified: true,
          creatorAvatar: '/tastekin-media/fheed-profile.webp',
          following: true,
          edit: quietTailoringFeed,
        }],
      }),
    });
  });
  await page.reload();
  await openConsumerProfile(page);

  // fheed-profile-mini is this same signed-in creator's own profile — the
  // owner view, which now shares the travel-first layout (cover, stats,
  // travel tabs) with the visitor view; only Follow/Message/My Circle stay
  // hidden and Edit profile/Insights/overflow menu remain owner-only.
  await expect(page.locator('[data-testid^="profile-category-"]')).toHaveCount(0);
  await expect(page.getByTestId('profile-cover')).toBeVisible();
  for (const tab of ['All', 'Trips', 'Stays', 'Food', 'Places', 'Tips', 'Style']) {
    await expect(page.getByTestId(`profile-travel-tab-${tab}`)).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveCount(0);
  await expect(page.getByTestId('profile-edits-grid')).toHaveAttribute('data-active-category', 'All');
  await expect(page.locator('.approved-logo')).toHaveCount(0);
  await expect(page.getByText(/^Age \d+$/)).toHaveCount(0);
  await expect(page.locator('.approved-grid-card')).not.toHaveCount(0);

  await page.getByTestId('nav-home').click();
  await expect(page.locator('.approved-logo')).toBeVisible();
});

test('hides a Featured collection whose only cover is a locked Edit, instead of showing it blurred or dark', async ({ page }) => {
  // "The Coastal Edit" (from the shared beforeEach mock) has no coverImage
  // of its own — its only cover comes from the locked private-hotel Edit,
  // whose image is already a pre-blurred subscriber preview. There is no
  // real, unblurred photo to show for it here, so the Featured collections
  // strip must omit the card entirely rather than render it blurred or dark.
  await openConsumerProfile(page);
  const featuredCards = page.locator('[data-testid^="featured-collection-"]');
  await expect(featuredCards).toHaveCount(1);
  await expect(page.getByTestId('featured-collection-quiet-luxury')).toBeVisible();
  await expect(page.getByTestId('featured-collection-coastal-edit')).toHaveCount(0);
  await expect(page.getByText('The Coastal Edit')).toHaveCount(0);
});

test('"View all" is hidden with zero or one visible Featured collection, shown only with two or more, for owner and visitor alike', async ({ page }) => {
  // Default beforeEach mock: exactly one visible Featured collection
  // (quiet-luxury; coastal-edit is filtered out — see the test above).
  await openConsumerProfile(page);
  await expect(page.getByTestId('featured-collection-quiet-luxury')).toBeVisible();
  await expect(page.getByTestId('profile-featured-viewall')).toHaveCount(0);

  // Add a second real, visible public collection and reopen the profile —
  // "View all" must now appear.
  const secondPublicEdit = { ...quietTailoringFeed, id: 'weekend-market', title: 'Weekend market finds', titleAr: 'اكتشافات سوق نهاية الأسبوع', collectionIds: ['weekend-picks'] };
  await page.route('**/api/creator-workspace', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        creatorId: 'fheed', revision: 1,
        edits: [{ ...quietTailoringFeed, collectionIds: ['quiet-luxury'] }, privateHotelFeed, secondPublicEdit],
        collections: [
          { id: 'quiet-luxury', title: 'Quiet Luxury', titleAr: 'فخامة هادئة', description: '', descriptionAr: '', access: 'public', coverEditId: 'quiet-tailoring', editIds: ['quiet-tailoring'] },
          { id: 'coastal-edit', title: 'The Coastal Edit', titleAr: 'اختيارات الساحل', description: '', descriptionAr: '', access: 'locked', coverEditId: 'private-hotel', editIds: ['private-hotel'] },
          { id: 'weekend-picks', title: 'Weekend Picks', titleAr: 'اختيارات نهاية الأسبوع', description: '', descriptionAr: '', access: 'public', coverEditId: 'weekend-market', editIds: ['weekend-market'] },
        ],
      }),
    });
  });
  await page.route('**/api/creator-featured-collections', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: ['quiet-luxury', 'coastal-edit', 'weekend-picks'] }) });
  });
  // This SPA keeps screen state in memory, not the URL — a reload lands
  // back on Home, so the profile must be re-opened after it.
  await page.reload();
  await openConsumerProfile(page);
  await expect(page.getByTestId('featured-collection-quiet-luxury')).toBeVisible();
  await expect(page.getByTestId('featured-collection-weekend-picks')).toBeVisible();
  await expect(page.getByTestId('profile-featured-viewall')).toBeVisible();
  await page.getByTestId('profile-featured-viewall').click();
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
});

test('shows "Apply for the Taste Seal" before applying, then a disabled "Application under review" once a pending application exists', async ({ page }) => {
  // /api/creator-profile is fetched once, in a useEffect right after the
  // session loads at app boot — well before this test ever navigates to the
  // Profile screen. The override must be registered before that first
  // navigation (the beforeEach's own page.goto('/')), so re-navigate here
  // rather than relying on openConsumerProfile's earlier page load.
  await page.route('**/api/creator-profile', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        displayName: 'Fheed Alaiban', username: 'fheed', bio: '', city: 'Kuwait City', country: 'Kuwait', interests: [],
        avatar: '/tastekin-media/fheed-profile.webp', avatarObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: false, revision: 1,
      }),
    });
  });
  let applicationStatus: 'none' | 'pending' = 'none';
  await page.route('**/api/verification-application', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ application: applicationStatus === 'pending' ? { statement: 'x'.repeat(40), evidenceLinks: [], status: 'pending' } : null }) });
  });
  await page.goto('/');
  await openConsumerProfile(page);
  await expect(page.getByTestId('profile-apply-verification')).toContainText('Apply for the Taste Seal');
  await expect(page.getByTestId('profile-verification-pending')).toHaveCount(0);

  applicationStatus = 'pending';
  await page.reload();
  await openConsumerProfile(page);
  await expect(page.getByTestId('profile-verification-pending')).toContainText('Application under review');
  await expect(page.getByTestId('profile-verification-pending')).toBeDisabled();
  await expect(page.getByTestId('profile-apply-verification')).toHaveCount(0);
});

test('keeps Home and Explore state while the profile stays uncluttered at mobile width', async ({ page }) => {
  const homeTabs = page.locator('.approved-feed-tabs');
  const homeTabsBox = await homeTabs.boundingBox();
  expect(homeTabsBox?.x).toBeGreaterThanOrEqual(0);
  expect((homeTabsBox?.x ?? 0) + (homeTabsBox?.width ?? 0)).toBeLessThanOrEqual(390);

  await page.getByTestId('nav-explore').click();
  await page.getByTestId('category-Travel').click();
  await expect(page.getByTestId('category-Travel')).toHaveClass(/active/);
  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.locator('.profile-edit-filters')).toHaveCount(0);
  await expect(page.locator('[data-testid^="profile-category-"]')).toHaveCount(0);
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-tab-following').click();
  await expect(page.getByTestId('home-tab-following')).toHaveClass(/active/);
  await page.getByTestId('nav-explore').click();
  await expect(page.getByTestId('category-Travel')).toHaveClass(/active/);

  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.locator('.profile-edit-filters')).toHaveCount(0);
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
});

test('keeps profile media edge-to-edge and shows the default feed for another creator', async ({ page }) => {
  await page.route('**/api/explore**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: false,
        sort: 'new',
        creators: [
          {
            id: 'fheed-alaiban',
            username: 'fheed',
            displayName: 'Fheed Alaiban',
            avatar: '/tastekin-media/fheed-profile.webp',
            categories: ['Fashion', 'Travel', 'Places'],
            matchScore: null,
            matchReasons: [],
          },
          {
            id: 'noura-studio',
            username: 'noura.studio',
            displayName: 'Noura Studio',
            avatar: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=600&q=85',
            categories: ['Restaurants', 'Places', 'Travel', 'Decor'],
            matchScore: null,
            matchReasons: [],
          },
        ],
        edits: [],
      }),
    });
  });
  await openConsumerProfile(page);

  const profileGrid = page.getByTestId('profile-edits-grid');
  await expect(profileGrid).toHaveAttribute('data-active-category', 'All');

  await expect(page.locator('[data-testid^="profile-category-"]')).toHaveCount(0);
  const photoCards = profileGrid.locator('.photo-grid-card');
  await expect(photoCards).not.toHaveCount(0);
  const mediaLayout = await photoCards.evaluateAll((cards) => cards.map((card) => {
    const media = card.querySelector<HTMLElement>('.profile-grid-media')!;
    const image = card.querySelector<HTMLImageElement>('img')!;
    const cardBox = card.getBoundingClientRect();
    const mediaBox = media.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    return {
      cardRatio: cardBox.height / cardBox.width,
      mediaWidth: mediaBox.width,
      mediaHeight: mediaBox.height,
      imageWidth: imageBox.width,
      imageHeight: imageBox.height,
      objectFit: getComputedStyle(image).objectFit,
      captionCount: card.querySelectorAll('.profile-grid-caption').length,
      hasPaywallLabel: card.textContent?.includes('Subscribers only') ?? false,
    };
  }));
  // The grid never shows lock badges, blur, or "Subscribers only" labels.
  // The owner's own locked Edit (see the global creator-workspace mock's
  // private-hotel Edit) is excluded from this grid entirely rather than
  // rendered with any paywall styling.
  expect(mediaLayout.every((item) => !item.hasPaywallLabel)).toBe(true);
  // Thumbnails are photo-first and clean — no title/caption text overlay on
  // the grid card itself. The caption is still available once the post is
  // opened (see Edit Detail); it's just never drawn over the thumbnail here.
  expect(mediaLayout.every((item) => item.captionCount === 0)).toBe(true);
  for (const item of mediaLayout) {
    expect(item.cardRatio).toBeCloseTo(1.25, 1);
    expect(item.objectFit).toBe('cover');
    expect(item.imageWidth).toBeCloseTo(item.mediaWidth, 1);
    expect(item.imageHeight).toBeCloseTo(item.mediaHeight, 1);
  }

  await page.getByTestId('nav-explore').click();
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByTestId('creator-noura.studio').click();
  await expect(page.getByRole('heading', { name: 'Noura Studio' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveClass(/primary/);
  await expect(page.getByRole('button', { name: 'Message' })).toBeVisible();
  await expect(page.getByTestId('profile-circle-action')).toBeVisible();
  await expect(page.getByText('My Circle')).toBeVisible();
  await expect(page.getByRole('button', { name: 'More options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);
  await expect(page.locator('.approved-logo')).toHaveCount(0);
  await expect(page.getByText(/^Age \d+$/)).toHaveCount(0);
  await expect(profileGrid).toHaveAttribute('data-active-category', 'All');
  await expect(page.locator('[data-testid^="profile-category-"]')).toHaveCount(0);
  await expect(page.getByText('No published Edits yet.')).toBeVisible();

  // A genuine visitor to a different creator's profile — this is where the
  // travel redesign (cover, stats, and the fixed travel tab row) actually
  // applies. noura.studio has no published Edits at all here, so the cover
  // safely falls back to a plain gradient rather than any photo.
  const cover = page.getByTestId('profile-cover');
  await expect(cover).toBeVisible();
  await expect(cover.locator('img')).toHaveCount(0);
  for (const tab of ['All', 'Trips', 'Stays', 'Food', 'Places', 'Tips', 'Style']) {
    await expect(page.getByTestId(`profile-travel-tab-${tab}`)).toBeVisible();
  }
  await expect(page.getByTestId('profile-travel-tab-All')).toHaveClass(/active/);
  await page.getByTestId('profile-travel-tab-Trips').click();
  await expect(page.getByTestId('profile-edits-grid')).toHaveAttribute('data-active-category', 'Trips');
  await expect(page.getByText('Nothing in Trips yet.')).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
});

test('the profile filter row scrolls horizontally at 390px without clipping any category, in English and Arabic/RTL', async ({ page }) => {
  await openConsumerProfile(page);
  const row = page.locator('.profile-travel-tabs');
  const enLayout = await row.evaluate((element) => ({
    scrollable: element.scrollWidth > element.clientWidth,
    tabCount: element.querySelectorAll('button').length,
    everyTabHasWidth: Array.from(element.querySelectorAll('button')).every((button) => button.getBoundingClientRect().width > 0),
  }));
  expect(enLayout.scrollable).toBe(true);
  expect(enLayout.tabCount).toBe(7);
  expect(enLayout.everyTabHasWidth).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);

  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-language-ar').click();
  await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'رجوع' }).click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
  const arLayout = await row.evaluate((element) => ({
    scrollable: element.scrollWidth > element.clientWidth,
    everyTabHasWidth: Array.from(element.querySelectorAll('button')).every((button) => button.getBoundingClientRect().width > 0),
  }));
  expect(arLayout.scrollable).toBe(true);
  expect(arLayout.everyTabHasWidth).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
  // Selected-filter styling still applies correctly under RTL.
  await expect(page.getByTestId('profile-travel-tab-All')).toHaveClass(/active/);
});

// A Latin/mixed display name must render in full on the Arabic page, not
// just be present in the accessible name — Playwright's role-based
// `getByRole('heading', ...)` matches the DOM text content regardless of
// visual CSS truncation, so it alone can't catch a name that's actually
// being clipped on screen. These checks compare scrollWidth to
// clientWidth, which does.
const NAME_CASES: { key: string; name: string }[] = [
  { key: 'a fully Latin name', name: 'Fheed Alaiban' },
  { key: 'a fully Arabic name', name: 'فهد العليبان' },
  { key: 'a mixed Arabic/Latin name', name: 'Fheed العليبان' },
];

for (const { key, name } of NAME_CASES) {
  test(`AR owner and visitor profiles render ${key} in full at 390px, not clipped from the wrong end`, async ({ page }) => {
    // /api/creator-profile and /api/me's creator.displayName are both
    // fetched once, in a useEffect right after the session loads at app
    // boot — before this test's own page.goto('/?lang=ar') below, so both
    // overrides must be registered first.
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'fheed-founder', email: 'founder@tastekin.test' }, role: 'creator',
          creator: { id: 'fheed', handle: 'fheed', displayName: name, verified: true, ownsWorkspace: true },
          featureFlags: { my_circle: true },
        }),
      });
    });
    await page.route('**/api/creator-profile', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          displayName: name, username: 'fheed', bio: '', city: 'Kuwait City', country: 'Kuwait', interests: [],
          avatar: '/tastekin-media/fheed-profile.webp', avatarObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: 1,
        }),
      });
    });
    // openConsumerProfile() hardcodes the English Explore heading AND the
    // literal name 'Fheed Alaiban', so it only works for the default fixture
    // name in English. Navigate to the profile in English first (matching
    // the app's real boot language), then switch to Arabic via the in-app
    // language toggle — the same pattern the filter-row-scroll test above
    // uses — so this works for all three NAME_CASES, not just the Latin one.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-explore').click();
    await expect(page.getByRole('heading', { name: 'Find your next taste.' })).toBeVisible();
    await page.getByTestId('fheed-profile-mini').click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await page.getByTestId('open-settings-topbar').click();
    await page.getByTestId('settings-language-ar').click();
    await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('button', { name: 'رجوع' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    const assertNameFullyVisible = async () => {
      const h1 = page.locator('.approved-name h1');
      await expect(h1).toHaveText(name);
      const box = await h1.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
    };

    await assertNameFullyVisible();

    await page.getByRole('button', { name: 'مزيد من الخيارات' }).click();
    await page.getByTestId('profile-view-public').click();
    await assertNameFullyVisible();
  });
}

test('shows all visitor actions when an admin views an unverified empty profile in English and RTL', async ({ page }) => {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      body: JSON.stringify({
        user: { id: 'admin-user', email: 'admin@tastekin.test' },
        role: 'admin',
        creator: null,
        isAdmin: true,
        featureFlags: { my_circle: true },
      }),
    });
  });
  await page.reload();
  await page.getByTestId('nav-explore').click();
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByTestId('creator-noura.studio').click();

  await expect(page.getByRole('heading', { name: 'Noura Studio' })).toBeVisible();
  await expect(page.getByText('No published Edits yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveClass(/primary/);
  await expect(page.getByRole('button', { name: 'Message' })).toBeVisible();
  await expect(page.getByTestId('profile-circle-action')).toBeVisible();
  await expect(page.getByText('My Circle')).toBeVisible();
  await expect(page.getByRole('button', { name: 'More options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);

  await page.getByTestId('open-settings-topbar').click();
  await page.getByTestId('settings-language-ar').click();
  await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'رجوع' }).click();
  await expect(page.getByRole('button', { name: 'متابعة' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'مراسلة' })).toBeVisible();
  await expect(page.getByText('دائرتي')).toBeVisible();
  await expect(page.getByRole('button', { name: 'مزيد من الخيارات' })).toBeVisible();
});

test('keeps visitor Profile actions at their approved dimensions for short and long names at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const displayName of ['Noura Studio', 'Noura Studio With A Considerably Longer Display Name']) {
    await page.unroute('**/api/creators/noura.studio/profile');
    await page.route('**/api/creators/noura.studio/profile', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          displayName,
          username: 'noura.studio',
          bio: '',
          city: 'Kuwait City',
          country: 'Kuwait',
          interests: ['Restaurants', 'Places'],
          avatar: '',
          avatarObjectPath: null,
          age: 31,
          dateOfBirth: '1995-01-01',
          showAge: true,
          verified: false,
          revision: 1,
        }),
      });
    });
    await page.goto('/');
    await page.getByTestId('nav-explore').click();
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByTestId('creator-noura.studio').click();
    await expect(page.getByRole('heading', { name: displayName })).toBeVisible();
    await expectVisitorActionsAt390(page);
  }
});

test('keeps locked profile edits excluded from the grid for both the owner and a visitor preview', async ({ page }) => {
  const lockedEdit = () => page.locator('.approved-grid-card').filter({ hasText: 'The stay, the packing list, and where I ate.' });

  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveCount(0);
  // The Profile Edits grid shows only public, published Edits — for the
  // owner's own (non-preview) view too. A locked Edit is excluded entirely
  // rather than shown with a lock badge, blur, or dark placeholder tile.
  await expect(lockedEdit()).toHaveCount(0);
  await expect(page.getByTestId('profile-edits-grid')).not.toContainText('Subscribers only');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByTestId('profile-view-public').click();
  await expect(page.getByRole('button', { name: 'Follow' })).toBeDisabled();
  // Same holds for a visitor (including the owner previewing as one).
  await expect(lockedEdit()).toHaveCount(0);
  await expect(page.getByTestId('profile-edits-grid')).not.toContainText('Subscribers only');
});

test('keeps each public Edit mapped to its own media after travel filtering', async ({ page }) => {
  const publicEdits = [
    { ...quietTailoringFeed, id: 'stable-fashion-edit', image: '/tastekin-media/stable-fashion.webp' },
    { ...quietTailoringFeed, id: 'stable-travel-edit', category: 'Travel', image: '/tastekin-media/stable-travel.webp' },
    { ...quietTailoringFeed, id: 'stable-place-edit', category: 'Places', image: '/tastekin-media/stable-place.webp' },
  ];
  await page.route('**/api/creator-workspace', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ creatorId: 'fheed', revision: 1, edits: publicEdits, collections: [] }),
    });
  });
  await page.reload();
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();

  for (const edit of publicEdits) {
    await expect(page.getByTestId(`profile-edit-${edit.id}`).locator('img')).toHaveAttribute('src', edit.image);
  }

  await page.getByTestId('profile-travel-tab-Trips').click();
  await expect(page.getByTestId('profile-edit-stable-travel-edit').locator('img')).toHaveAttribute('src', '/tastekin-media/stable-travel.webp');
  await expect(page.getByTestId('profile-edit-stable-fashion-edit')).toHaveCount(0);
  await expect(page.getByTestId('profile-edit-stable-place-edit')).toHaveCount(0);
});

test('persists saves and supports named Saved lists', async ({ page }) => {
  test.setTimeout(25_000);
  await page.route('**/api/public-feed', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [quietTailoringFeed, privateHotelFeed].map((edit) => ({
          creatorUsername: 'fheed', creatorName: 'Fheed Alaiban', creatorVerified: true,
          creatorAvatar: '/tastekin-media/fheed-profile.webp', following: false, edit,
        })),
      }),
    });
  });
  await page.reload();
  const listPicker = page.getByLabel('Add to lists');
  await page.getByTestId('save-quiet-tailoring').click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(listPicker).toBeHidden();
  await page.getByTestId('nav-saved').click();
  await expect(page.getByRole('button', { name: 'All Saved' })).toHaveClass(/active/);
  await expect(page.getByTestId('saved-grid-quiet-tailoring')).toBeVisible();
  await page.getByTestId('saved-grid-quiet-tailoring').getByRole('button', { name: 'Remove from saved' }).click();
  await page.getByRole('button', { name: 'Create list' }).click();
  await page.getByLabel('List name').fill('London Trip');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('button', { name: 'London Trip' })).toHaveClass(/active/);

  await page.getByTestId('nav-home').click();
  await page.getByTestId('save-quiet-tailoring').click();
  await expect(listPicker).toBeVisible();
  await listPicker.getByText('London Trip').click();
  await listPicker.getByRole('button', { name: 'Done' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByLabel('Add to lists')).toBeHidden();
  await page.getByTestId('edit-title-quiet-tailoring').click();
  const detailSave = page.locator('.edit-reactions').getByRole('button', { name: 'Saved', exact: true });
  await expect(detailSave).toHaveAttribute('aria-pressed', 'true');
  await expect(detailSave.locator('svg')).toHaveAttribute('fill', 'currentColor');
  await page.reload();
  await page.getByTestId('nav-home').click();
  await page.getByTestId('edit-title-quiet-tailoring').click();
  await expect(detailSave).toHaveAttribute('aria-pressed', 'true');
  await detailSave.click();
  await expect(page.locator('.edit-reactions').getByRole('button', { name: 'Save', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('nav-home').click();
  await page.getByTestId('save-quiet-tailoring').click();
  await expect(listPicker).toBeVisible();
  await listPicker.getByRole('button', { name: 'Done' }).evaluate((button: HTMLButtonElement) => button.click());
  await page.getByTestId('save-private-hotel').click();
  await expect(listPicker).toBeVisible();
  await listPicker.getByRole('button', { name: 'Done' }).evaluate((button: HTMLButtonElement) => button.click());

  await page.getByTestId('nav-saved').click();
  await page.getByRole('button', { name: 'London Trip' }).click();
  await expect(page.getByTestId('saved-grid-quiet-tailoring')).toBeVisible();
  await expect(page.getByTestId('saved-grid-private-hotel')).toHaveCount(0);
  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('button', { name: 'Rename list' }).click();
  await page.getByLabel('List name').fill('London Favourites');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'London Favourites' })).toBeVisible();
  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('button', { name: 'Delete list' }).click();
  await expect(page.getByText('Its posts will remain in All Saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Delete list' }).click();
  await expect(page.getByRole('button', { name: 'All Saved' })).toHaveClass(/active/);
  await expect(page.getByTestId('saved-grid-quiet-tailoring')).toBeVisible();
  await expect(page.getByTestId('saved-grid-private-hotel')).toBeVisible();
  await expect(page.locator('.saved-grid-card')).toHaveCount(2);
  await expect(page.locator('.saved-grid')).toHaveCSS('grid-template-columns', /.+ .+/);
  await expect(page.getByTestId('saved-grid-quiet-tailoring').locator('small')).toHaveText('Style');
  await expect(page.getByTestId('saved-grid-private-hotel').locator('small')).toHaveText('Trips');
  await page.setViewportSize({ width: 390, height: 844 });
  if (process.env.CAPTURE_SAVED_SCREENSHOT) await page.screenshot({ path: '../../screenshots/tastekin-saved-lists-390x844.png' });
  await page.getByTestId('saved-grid-quiet-tailoring').getByRole('button', { name: /Open/ }).click();
  await expect(page.getByText('A soft-structured look for a long city day.')).toBeVisible();
  await page.getByTestId('nav-saved').click();
  await page.getByTestId('saved-grid-quiet-tailoring').getByRole('button', { name: 'Remove from saved' }).click();
  await expect(page.locator('.saved-grid-card')).toHaveCount(1);
});

test('keeps owner controls compact without a standalone preview button and persists featured collection choices', async ({ page }) => {
  let featuredIds = ['quiet-luxury', 'coastal-edit'];
  await page.route('**/api/creator-workspace', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        creatorId: 'fheed',
        revision: 1,
        edits: [
          { id: 'quiet-tailoring', category: 'Fashion', title: 'Quiet tailoring', titleAr: 'أناقة هادئة', caption: 'A soft-structured look for a long city day.', captionAr: 'إطلالة مريحة ومنسّقة ليوم طويل في المدينة.', image: '/tastekin-media/quiet-tailoring.webp', location: 'Mayfair, London', locationAr: 'مايفير، لندن', altText: 'Tailoring.', access: 'public', status: 'published', collectionIds: ['quiet-luxury'] },
          { id: 'private-hotel', category: 'Travel', title: 'Private hotel weekend', titleAr: 'عطلة فندقية خاصة', caption: 'The stay, the packing list, and where I ate.', captionAr: 'الإقامة، قائمة الحقائب، والأماكن التي تناولت فيها الطعام.', image: '/tastekin-media/private-hotel-preview.webp', location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: 'Private hotel preview.', access: 'locked', status: 'published', collectionIds: ['coastal-edit'] },
        ],
        collections: [
          { id: 'quiet-luxury', title: 'Quiet Luxury', titleAr: 'فخامة هادئة', description: 'Tailoring, materials, and a quieter way to dress.', descriptionAr: 'تفصيل وخامات وطريقة أكثر هدوءاً في ارتداء الملابس.', access: 'public', coverEditId: 'quiet-tailoring', editIds: ['quiet-tailoring'] },
          // An explicit coverImage keeps this collection's Featured-strip card
          // visible on its own uploaded cover, independent of its 'locked'
          // access (which otherwise hides a collection whose only cover would
          // come from a locked Edit's blurred preview) — this test exercises
          // feature/unfeature toggling, not that unrelated cover-visibility rule.
          { id: 'coastal-edit', title: 'The Coastal Edit', titleAr: 'اختيارات الساحل', description: 'Places, packing and private travel notes.', descriptionAr: 'أماكن وحقائب وملاحظات سفر خاصة.', access: 'locked', coverImage: '/tastekin-media/private-hotel-preview.webp', coverEditId: 'private-hotel', editIds: ['private-hotel'] },
        ],
      }),
    });
  });
  await page.route('**/api/creator-featured-collections', async (route) => {
    if (route.request().method() === 'PUT') {
      featuredIds = route.request().postDataJSON().collectionIds;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collectionIds: featuredIds }) });
  });
  await page.reload();
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();

  await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View as visitor' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByTestId('profile-view-public')).toContainText('View public profile');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Insights' })).toBeVisible();
  const ownerControlHeights = await page.locator('.profile-edit-button, .profile-insights-button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(ownerControlHeights).toEqual([48, 48]);

  const featuredCards = page.locator('[data-testid^="featured-collection-"]');
  await expect(featuredCards).toHaveCount(2);
  await page.getByTestId('featured-collection-quiet-luxury').click();
  await expect(page.getByRole('heading', { name: 'Quiet Luxury' })).toBeVisible();

  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-creator-workspace').click();
  await page.getByRole('button', { name: 'Manage collections' }).click();
  await expect(page.getByRole('button', { name: 'Unfeature' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Move featured collection later' }).first().click();
  await page.getByRole('button', { name: 'Unfeature' }).first().click();

  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(featuredCards).toHaveCount(1);
  await expect(page.getByTestId('featured-collection-quiet-luxury')).toHaveCount(0);
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);

  expect(featuredIds).toEqual(['coastal-edit']);
  await page.reload();
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(featuredCards).toHaveCount(1);
  await expect(page.getByTestId('featured-collection-quiet-luxury')).toHaveCount(0);
});

test('keeps a subscriber-only edit on its locked preview until media access is authorized', async ({ page }) => {
  await switchToConsumer(page);
  await page.getByTestId('nav-home').click();
  await page.getByTestId('edit-title-private-hotel').click();

  await expect(page.locator('.approved-detail-art')).toHaveClass(/locked/);
  await expect(page.getByText('This edit is for subscribers')).toBeVisible();
  await expect(page.getByRole('button', { name: /Subscribe/ })).toBeVisible();

  await page.getByRole('button', { name: /Subscribe/ }).click();
  await expect(page.getByRole('heading', { name: 'Subscribe to Fheed Alaiban' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Subscribe/ })).toBeDisabled();
  await expect(page.getByText('No payment or access is being simulated.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save this edit' })).toHaveCount(0);
});