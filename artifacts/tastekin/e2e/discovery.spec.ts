import { expect, test, type Page } from '@playwright/test';

async function openConsumerProfile(page: Page) {
  await page.getByTestId('nav-explore').click();
  await expect(page.getByRole('heading', { name: 'Find your next taste.' })).toBeVisible();
  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
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
      captions: Array.from(card.querySelectorAll<HTMLElement>('.profile-grid-caption')).map((caption) => {
        const captionBox = caption.getBoundingClientRect();
        const styles = getComputedStyle(caption);
        return {
          withinCard: captionBox.left >= cardBox.left && captionBox.right <= cardBox.right && captionBox.bottom <= cardBox.bottom,
          oneLineEllipsis: styles.whiteSpace === 'nowrap' && styles.overflow === 'hidden' && styles.textOverflow === 'ellipsis',
          truncated: caption.scrollWidth > caption.clientWidth,
        };
      }),
      hasPaywallLabel: card.textContent?.includes('Subscribers only') ?? false,
    };
  }));
  // The grid never shows lock badges, blur, or "Subscribers only" labels.
  // The owner's own locked Edit (see the global creator-workspace mock's
  // private-hotel Edit) is excluded from this grid entirely rather than
  // rendered with any paywall styling.
  expect(mediaLayout.every((item) => !item.hasPaywallLabel)).toBe(true);
  for (const item of mediaLayout) {
    expect(item.cardRatio).toBeCloseTo(1.25, 1);
    expect(item.objectFit).toBe('cover');
    expect(item.imageWidth).toBeCloseTo(item.mediaWidth, 1);
    expect(item.imageHeight).toBeCloseTo(item.mediaHeight, 1);
    expect(item.captions.every((caption) => caption.withinCard && caption.oneLineEllipsis)).toBe(true);
  }
  expect(mediaLayout.some((item) => item.captions.some((caption) => caption.truncated))).toBe(true);

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

test('persists saves, collections, and the owner profile entry point', async ({ page }) => {
  await page.route('**/api/public-feed', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          creatorUsername: 'fheed',
          creatorName: 'Fheed Alaiban',
          creatorVerified: true,
          creatorAvatar: '/tastekin-media/fheed-profile.webp',
          following: false,
          edit: quietTailoringFeed,
        }],
      }),
    });
  });
  await page.reload();
  await page.getByTestId('edit-title-quiet-tailoring').click();
  await page.getByRole('button', { name: 'Save this edit' }).click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.getByTestId('nav-saved').click();
  await expect(page.getByTestId('edit-card-quiet-tailoring')).toBeVisible();
  await page.getByTestId('save-quiet-tailoring').click();
  await expect(page.getByText('Nothing saved yet. Explore creators and keep what speaks to you.')).toBeVisible();

  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByTestId('profile-edits-grid')).toHaveAttribute('data-active-category', 'All');
  await page.getByRole('button', { name: 'Collections' }).click();
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
  await expect(page.locator('.approved-collection')).toHaveCount(2);
  await page.getByRole('button', { name: /Quiet Luxury/ }).click();
  await expect(page.getByRole('heading', { name: 'Quiet Luxury' })).toBeVisible();

  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
   await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
   await expect(page.getByRole('button', { name: 'Open inbox' })).toBeVisible();
   await expect(page.getByRole('button', { name: 'View as visitor' })).toHaveCount(0);
   await expect(page.getByRole('button', { name: 'Follow' })).toHaveCount(0);
   await page.getByRole('button', { name: 'More options' }).click();
   await page.getByTestId('profile-view-public').click();
   await expect(page.getByRole('button', { name: 'Follow' })).toBeDisabled();
   await expect(page.getByRole('button', { name: /Subscribe · \$19\.99/ })).toBeDisabled();
   await page.getByRole('button', { name: 'Exit visitor preview' }).click();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible();
  await expect(page.getByLabel('Change profile photo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible();
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