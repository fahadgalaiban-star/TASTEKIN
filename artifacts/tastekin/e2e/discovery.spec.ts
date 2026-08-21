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
  await expect(page.getByRole('heading', { name: 'Alex Morgan' })).toBeVisible();
}

async function openConsumerProfile(page: Page) {
  await page.getByTestId('nav-explore').click();
  await expect(page.getByRole('heading', { name: 'Find your next taste.' })).toBeVisible();
  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tastekin:')) localStorage.removeItem(key);
    }
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
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed.' })).toBeVisible();
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
  await page.getByTestId('edit-title-quiet-tailoring').click();
  await page.getByRole('button', { name: 'Save this edit' }).click();
  await expect(page.getByRole('main').getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.getByTestId('nav-saved').click();
  await expect(page.getByTestId('edit-card-quiet-tailoring')).toBeVisible();
  await page.getByTestId('save-quiet-tailoring').click();
  await expect(page.getByText('Nothing saved yet. Explore Fheed’s edits and keep what speaks to you.')).toBeVisible();

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

test('keeps a subscriber-only edit on its locked preview until media access is authorized', async ({ page }) => {
  await switchToConsumer(page);
  await page.getByTestId('nav-home').click();
  await page.getByTestId('edit-title-private-hotel').click();

  await expect(page.locator('.approved-detail-art')).toHaveClass(/locked/);
  await expect(page.getByText('This edit is for subscribers')).toBeVisible();
  await expect(page.getByRole('button', { name: /Subscribe/ })).toBeVisible();

  await page.getByRole('button', { name: /Subscribe/ }).click();
  await expect(page.getByRole('heading', { name: 'Subscribe to Fheed' })).toBeVisible();
  await page.getByRole('button', { name: /Subscribe/ }).click();
  await expect(page.getByRole('heading', { name: 'You’re subscribed' })).toBeVisible();

  await page.getByTestId('nav-home').click();
  await page.getByTestId('edit-title-private-hotel').click();
  await expect(page.locator('.approved-detail-art')).toHaveClass(/locked/);
  await expect(page.getByText('This edit is for subscribers')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Subscription pending confirmation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save this edit' })).toHaveCount(0);
});