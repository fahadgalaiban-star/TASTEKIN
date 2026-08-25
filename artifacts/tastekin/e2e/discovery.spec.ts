import { expect, test, type Page } from '@playwright/test';

const categoryIds = [
  'All',
  'Fashion',
  'Travel',
  'Places',
  'Restaurants',
  'DailyRoutine',
  'PersonalCare',
  'HealthFitness',
  'Decor',
  'Books',
  'Vlogs',
] as const;

async function switchToConsumer(page: Page) {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByTestId('identity-consumer').click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
}

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
  await page.goto('/');
});

test('keeps the five mobile destinations, Home feed tabs, Explore filters, and RTL available', async ({ page }) => {
  const navigation = page.getByTestId('primary-navigation');

  await expect(navigation.getByRole('button')).toHaveCount(5);
  await expect(navigation).toContainText('Home');
  await expect(navigation).toContainText('Explore');
  await expect(navigation).toContainText('Add');
  await expect(navigation).toContainText('Saved');
  await expect(navigation).toContainText('You');

  await expect(page.getByTestId('home-tab-for-you')).toHaveClass(/active/);
  await expect(page.getByTestId('home-tab-following')).toBeVisible();
  await expect(page.getByTestId('home-tab-subscribed')).toBeVisible();
  await expect(page.getByTestId('category-All')).toHaveCount(0);
  await page.getByTestId('home-tab-following').click();
  await expect(page.getByText('No edits from people you follow yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Explore creators' }).click();

  await page.getByTestId('nav-explore').click();
  await expect(page.getByRole('heading', { name: 'Find your next taste.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Best Match' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible();
  await page.getByTestId('nav-add').click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed Alaiban.' })).toBeVisible();
  await page.getByTestId('nav-saved').click();
  await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible();
  await page.getByTestId('nav-you').click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await page.getByTestId('nav-explore').click();

  for (const categoryId of categoryIds) {
    const chip = page.getByTestId(`category-${categoryId}`);
    await chip.click();
    await expect(chip).toHaveClass(/active/);
    await expect(page.locator('article[data-testid^="edit-card-"]').first()).toBeVisible();
  }

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByTestId('language-ar').click();
  await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'rtl');
  await expect(navigation).toBeVisible();
  await expect(navigation).toContainText('الرئيسية');
  await expect(navigation).toContainText('اكتشف');
  await expect(navigation).toContainText('إضافة');
  await expect(navigation).toContainText('المحفوظات');
  await expect(navigation).toContainText('أنت');

  await page.getByTestId('language-en').click();
  await expect(page.locator('.approved-app')).toHaveAttribute('dir', 'ltr');
});

test('filters each creator profile independently of Home and Explore', async ({ page }) => {
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
  await switchToConsumer(page);
  await openConsumerProfile(page);

  await expect(page.getByTestId('profile-category-All')).toBeVisible();
  await expect(page.getByTestId('profile-category-Fashion')).toContainText('Fashion & Outfits');
  await expect(page.getByTestId('profile-category-DailyRoutine')).toContainText('Daily Routine');
  await expect(page.getByTestId('profile-category-DailyRoutine')).not.toContainText('DailyRoutine');
  await page.getByTestId('profile-category-Fashion').click();
  await expect(page.getByTestId('profile-category-Fashion')).toHaveClass(/active/);
  await expect(page.locator('.approved-grid-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'Follow' }).click();
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-tab-following').click();
  await expect(page.getByTestId('edit-card-quiet-tailoring')).toBeVisible();
  await page.getByTestId('home-tab-subscribed').click();
  await expect(page.getByText('No subscriber edits yet.')).toBeVisible();

  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByTestId('identity-owner').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await page.getByTestId('profile-category-Fashion').click();
  await expect(page.locator('.approved-grid-card')).toHaveCount(2);
});

test('keeps Home, Explore, and creator filter state isolated at mobile width', async ({ page }) => {
  const homeTabs = page.locator('.approved-feed-tabs');
  const homeTabsBox = await homeTabs.boundingBox();
  expect(homeTabsBox?.x).toBeGreaterThanOrEqual(0);
  expect((homeTabsBox?.x ?? 0) + (homeTabsBox?.width ?? 0)).toBeLessThanOrEqual(390);

  await page.getByTestId('nav-explore').click();
  await page.getByTestId('category-Travel').click();
  await expect(page.getByTestId('category-Travel')).toHaveClass(/active/);
  await page.getByTestId('fheed-profile-mini').click();
  await page.getByTestId('profile-category-Fashion').click();
  await expect(page.getByTestId('profile-category-Fashion')).toHaveClass(/active/);
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-tab-following').click();
  await expect(page.getByTestId('home-tab-following')).toHaveClass(/active/);
  await page.getByTestId('nav-explore').click();
  await expect(page.getByTestId('category-Travel')).toHaveClass(/active/);

  await page.getByTestId('fheed-profile-mini').click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByTestId('language-ar').click();
  const profileFilters = page.locator('.profile-edit-filters');
  await expect(profileFilters).toBeVisible();
  const filtersScrollHorizontally = await profileFilters.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.overflowX === 'auto' && element.scrollWidth > element.clientWidth;
  });
  expect(filtersScrollHorizontally).toBe(true);
});

test('keeps profile media edge-to-edge and resets the selected category for another creator', async ({ page }) => {
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
  await switchToConsumer(page);
  await openConsumerProfile(page);

  const profileGrid = page.getByTestId('profile-edits-grid');
  await expect(profileGrid).toHaveAttribute('data-active-category', 'All');

  for (const category of ['Fashion', 'Travel', 'Places', 'Restaurants'] as const) {
    await page.getByTestId(`profile-category-${category}`).click();
    await expect(page.getByTestId(`profile-category-${category}`)).toHaveClass(/active/);
    await expect(profileGrid.locator('.approved-grid-card')).not.toHaveCount(0);
  }

  await page.getByTestId('profile-category-All').click();
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
      locked: card.textContent?.includes('Subscribers only') ?? false,
    };
  }));
  expect(mediaLayout.some((item) => item.locked)).toBe(true);
  for (const item of mediaLayout) {
    expect(item.cardRatio).toBeCloseTo(1.25, 1);
    expect(item.objectFit).toBe('cover');
    expect(item.imageWidth).toBeCloseTo(item.mediaWidth, 1);
    expect(item.imageHeight).toBeCloseTo(item.mediaHeight, 1);
    expect(item.captions.every((caption) => caption.withinCard && caption.oneLineEllipsis)).toBe(true);
  }
  expect(mediaLayout.some((item) => item.captions.some((caption) => caption.truncated))).toBe(true);

  await page.getByTestId('profile-category-Restaurants').click();
  await expect(profileGrid).toHaveAttribute('data-active-category', 'Restaurants');
  await page.getByTestId('nav-explore').click();
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByTestId('creator-noura.studio').click();
  await expect(page.getByRole('heading', { name: 'Noura Studio' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Message' })).toHaveCount(0);
  await expect(profileGrid).toHaveAttribute('data-active-category', 'All');
  await expect(page.getByTestId('profile-category-All')).toHaveCount(0);
  await expect(page.getByText('No published Edits yet.')).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
});

test('keeps locked profile edits protected for visitor and owner preview', async ({ page }) => {
  const lockedEdit = () => page.locator('.approved-grid-card').filter({ hasText: 'The stay, the packing list, and where I ate.' });

  await switchToConsumer(page);
  await openConsumerProfile(page);
  await page.getByTestId('profile-category-Travel').click();
  await lockedEdit().click();
  await expect(page.locator('.approved-detail-art')).toHaveClass(/locked/);
  await expect(page.getByText('This edit is for subscribers')).toBeVisible();
  await expect(page.getByRole('button', { name: /Subscribe/ })).toBeVisible();

  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByTestId('identity-owner').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByRole('button', { name: 'Follow' })).toHaveCount(0);
  await page.getByRole('button', { name: 'View as visitor' }).click();
  await expect(page.getByRole('button', { name: 'Follow' })).toBeDisabled();
  await page.getByTestId('profile-category-Travel').click();
  await lockedEdit().click();
  await expect(page.locator('.approved-detail-art')).toHaveClass(/locked/);
  await expect(page.getByText('This edit is for subscribers')).toBeVisible();
});

test('persists saves, follow state, collections, and the owner profile entry point', async ({ page }) => {
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

  await switchToConsumer(page);
  await openConsumerProfile(page);
  await page.getByRole('button', { name: 'Follow' }).click();
  await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Subscribe · \$19\.99/ })).toBeVisible();
  await expect(page.getByText(/followers/i)).toHaveCount(0);
  await page.getByTestId('profile-category-Travel').click();
  await expect(page.locator('.approved-grid-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Collections' }).click();
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
  await expect(page.locator('.approved-collection')).toHaveCount(2);
  await page.getByRole('button', { name: /Quiet Luxury/ }).click();
  await expect(page.getByRole('heading', { name: 'Quiet Luxury' })).toBeVisible();
  await expect(page.getByText('Included edits')).toBeVisible();

  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByTestId('identity-owner').click();
  await page.getByRole('button', { name: 'View profile' }).click();
   await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
   await expect(page.getByRole('button', { name: 'Open inbox' })).toBeVisible();
   await expect(page.getByRole('button', { name: 'View as visitor' })).toBeVisible();
   await expect(page.getByRole('button', { name: 'Follow' })).toHaveCount(0);
   await page.getByRole('button', { name: 'View as visitor' }).click();
   await expect(page.getByRole('button', { name: 'Follow' })).toBeDisabled();
   await expect(page.getByRole('button', { name: /Subscribe · \$19\.99/ })).toBeDisabled();
   await page.getByRole('button', { name: 'Exit visitor preview' }).click();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible();
  await expect(page.getByLabel('Change profile photo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible();
});

test('keeps owner controls compact and persists featured collection choices', async ({ page }) => {
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
          { id: 'coastal-edit', title: 'The Coastal Edit', titleAr: 'اختيارات الساحل', description: 'Places, packing and private travel notes.', descriptionAr: 'أماكن وحقائب وملاحظات سفر خاصة.', access: 'locked', coverEditId: 'private-hotel', editIds: ['private-hotel'] },
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
  const visitorPreview = page.getByRole('button', { name: 'View as visitor' });
  await expect(visitorPreview).toBeVisible();
  const previewBox = await visitorPreview.boundingBox();
  expect(previewBox?.width).toBeLessThanOrEqual(52);
  await expect(page.getByRole('button', { name: 'Insights' })).toBeVisible();

  const featuredCards = page.locator('[data-testid^="featured-collection-"]');
  await expect(featuredCards).toHaveCount(2);
  await page.getByTestId('featured-collection-quiet-luxury').click();
  await expect(page.getByRole('heading', { name: 'Quiet Luxury' })).toBeVisible();

  await page.getByTestId('nav-add').click();
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