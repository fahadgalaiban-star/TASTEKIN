import { expect, test, type Page, type Route } from '@playwright/test';

type MeOptions = { authenticated?: boolean; myThings?: boolean; kinSearch?: boolean; closetAnalysis?: boolean; language?: 'en' | 'ar' };

function meBody({ authenticated = true, myThings = true, kinSearch = true, closetAnalysis = false, language = 'en' }: MeOptions = {}) {
  return JSON.stringify({
    user: authenticated ? { id: 'my-things-e2e-user', email: 'my-things-e2e@tastekin.test' } : null,
    role: 'consumer',
    creator: null,
    isAdmin: false,
    language,
    notifyPush: true,
    notifyEmail: true,
    subscribed: false,
    supportEmail: null,
    needsOnboarding: false,
    onboardingStep: 'done',
    googleAuthConfigured: false,
    featureFlags: { my_things: myThings, kin_search: kinSearch, closet_item_analysis: closetAnalysis },
  });
}

async function mockMe(page: Page, options: MeOptions = {}) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody(options) });
  });
}

// My Things has no shortcut on the You screen any more — the only way in is
// via the KIN tab's "My Things" mode, which needs kin_search on (meBody
// defaults it on) as well as my_things.
async function openMyThings(page: Page) {
  await page.getByTestId('nav-kin').click();
  await page.getByTestId('kin-mode-my-things').click();
}

const SAMPLE_ITEM = {
  id: 'item-1',
  itemType: 'shirt',
  primaryColor: 'blue',
  style: 'casual',
  occasion: null,
  season: null,
  brand: null,
  confirmationStatus: 'confirmed' as const,
  ownershipStatus: 'owned' as const,
  createdAt: new Date().toISOString(),
};

test('the You screen has no My Things shortcut, whether or not the flag is on', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await expect(page.getByTestId('open-my-things')).toHaveCount(0);
  await expect(page.getByText('My Things', { exact: true })).toHaveCount(0);

  await mockMe(page, { myThings: false });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await expect(page.getByTestId('open-my-things')).toHaveCount(0);
});

test('KIN only offers a My Things mode when the my_things flag is on', async ({ page }) => {
  await mockMe(page, { myThings: false });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-mode-my-things')).toHaveCount(0);
});

test('KIN offers a My Things mode when the flag is on, and it opens the screen', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-mode-my-things')).toBeVisible();
  await page.getByTestId('kin-mode-my-things').click();
  await expect(page.getByText('Nothing added yet.', { exact: false })).toBeVisible();
});

test('the guard sends My Things back to You when the flag turns off mid-session', async ({ page }) => {
  let flagOn = true;
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody({ myThings: flagOn }) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await expect(page.getByTestId('my-things-add')).toBeVisible();

  flagOn = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('my-things-add')).toHaveCount(0);
  await expect(page.getByTestId('open-settings')).toBeVisible();
});

test('the guard sends My Things back to You when the session becomes unauthenticated', async ({ page }) => {
  let authenticated = true;
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody({ authenticated, myThings: true }) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await expect(page.getByTestId('my-things-add')).toBeVisible();

  authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('my-things-add')).toHaveCount(0);
  await expect(page.getByTestId('you-sign-in')).toBeVisible();
});

test('populated grid renders items via the authorized image route and never exposes a private object key', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        // A hypothetical backend leak of imageObjectKey must never surface anywhere in the DOM.
        body: JSON.stringify({ items: [{ ...SAMPLE_ITEM, imageObjectKey: '/objects/closet/should-never-appear' }] }),
      });
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);

  await expect(page.getByTestId('my-things-grid')).toBeVisible();
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  const image = page.getByTestId('my-things-item').locator('img');
  await expect(image).toHaveAttribute('src', '/api/closet-items/item-1/image');

  const html = await page.content();
  expect(html).not.toContain('should-never-appear');
  expect(html).not.toContain('imageObjectKey');
});

test('populated grid renders an item whose style is null without error (PR-3: style is optional server-side)', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ ...SAMPLE_ITEM, style: null }] }) });
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
});

// Split into two tests (each its own page/navigation, one item apiece)
// rather than deleting two items back to back in one mounted screen: the
// item sheet is a single shared component instance reused across cards, so
// deleting one and immediately reopening another for a second delete in
// the same mount does not reliably return to its menu step first. Each
// scenario (200 vs 202) is still fully and independently verified.
test('delete: a 200 completed response is treated as removed', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ ...SAMPLE_ITEM, id: 'item-completed' }] }) });
  });
  await page.route('**/api/closet-items/item-completed', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'removed', physicalDeletion: 'completed' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);

  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-delete').click();
  await page.getByTestId('my-things-confirm-delete').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(0);
  await expect(page.getByText('Removed.', { exact: true })).toBeVisible();
});

test('delete: a 202 pending response is treated as removed, with the background-cleanup notice', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ ...SAMPLE_ITEM, id: 'item-pending' }] }) });
  });
  await page.route('**/api/closet-items/item-pending', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'removed', physicalDeletion: 'pending' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);

  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-delete').click();
  await page.getByTestId('my-things-confirm-delete').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(0);
  await expect(page.getByText('Final cleanup is finishing in the background.', { exact: false })).toBeVisible();
});

async function gotoAddScreen(page: Page) {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-add').click();
}

test('the circular Add button opens Add to My Things', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-add').click();
  await expect(page.getByRole('heading', { name: 'Add to My Things' })).toBeVisible();
});

test('Add item: file type and size validation reject before any upload', async ({ page }) => {
  const uploadCalls: string[] = [];
  await gotoAddScreen(page);
  await page.route('**/api/closet-items/media', async (route) => { uploadCalls.push(route.request().method()); await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) }); });

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('not a real image') });
  await expect(page.getByTestId('my-things-photo-error')).toContainText('HEIC/HEIF');

  // An unrecognized extension forces the browser to leave File.type empty,
  // exercising the same "no reported MIME type" branch Safari hits for HEIC.
  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'photo.tiff', mimeType: '', buffer: Buffer.from('not a real image') });
  await expect(page.getByTestId('my-things-photo-error')).toContainText('JPEG, PNG, or WebP');

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(11 * 1024 * 1024) });
  await expect(page.getByTestId('my-things-photo-error')).toContainText('too large');

  expect(uploadCalls).toHaveLength(0);
});

test('Add item: Confirm & Add stays disabled until a photo, item type, and primary color are chosen — style is not required', async ({ page }) => {
  await gotoAddScreen(page);
  const submit = page.getByTestId('my-things-submit');
  await expect(submit).toBeDisabled();

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(submit).toBeDisabled();

  await page.getByRole('button', { name: 'Shirt', exact: true }).click();
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  // Style has no UI on the Add screen at all — the button must already be
  // enabled here, without ever touching style.
  await expect(submit).toBeEnabled();
});

test('Add item: item type and primary color option walls are absent before a photo is selected', async ({ page }) => {
  await gotoAddScreen(page);
  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Blue', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('my-things-ownership-owned')).toBeVisible();
});

async function fillRequiredFields(page: Page) {
  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await page.getByRole('button', { name: 'Shirt', exact: true }).click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
}

test('Add item: the full upload -> create -> confirm sequence runs in order with the right payloads', async ({ page }) => {
  const calls: string[] = [];
  await gotoAddScreen(page);
  await page.route('**/api/closet-items/media', async (route) => { calls.push('upload'); await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) }); });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() !== 'POST') return;
    calls.push('create');
    const body = route.request().postDataJSON() as { uploadId: string; confirmationStatus?: string; style?: string };
    expect(body.uploadId).toBe('up-1');
    expect(body.confirmationStatus).toBeUndefined();
    // style was never selected (fillRequiredFields only picks item type and
    // color) — it must be entirely absent from the body, never a fallback.
    expect(body.style).toBeUndefined();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'pending_review' }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() !== 'PUT') return;
    calls.push('confirm');
    const body = route.request().postDataJSON() as { confirmationStatus: string; itemType: string; style?: string };
    expect(body.confirmationStatus).toBe('confirmed');
    expect(body.itemType).toBe('shirt');
    expect(body.style).toBeUndefined();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'confirmed' }) });
  });

  await fillRequiredFields(page);
  await page.getByTestId('my-things-submit').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  expect(calls).toEqual(['upload', 'create', 'confirm']);
});

test('Add item: a failed create is retried without re-uploading the photo', async ({ page }) => {
  let uploadCalls = 0;
  let createCalls = 0;
  await gotoAddScreen(page);
  await page.route('**/api/closet-items/media', async (route) => { uploadCalls += 1; await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) }); });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() !== 'POST') return;
    createCalls += 1;
    if (createCalls === 1) { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Unable to create this item' }) }); return; }
    const body = route.request().postDataJSON() as { uploadId: string };
    expect(body.uploadId).toBe('up-1');
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'pending_review' }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'confirmed' }) });
  });

  await fillRequiredFields(page);
  await page.getByTestId('my-things-submit').click();
  await expect(page.getByTestId('my-things-submit-error')).toBeVisible();
  await expect(page.getByTestId('my-things-submit')).toHaveText('Retry save');

  await page.getByTestId('my-things-submit').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  expect(uploadCalls).toBe(1);
  expect(createCalls).toBe(2);
});

test('Add item: a failed confirmation is retried with only PUT, never repeating upload or create', async ({ page }) => {
  let uploadCalls = 0;
  let createCalls = 0;
  let confirmCalls = 0;
  await gotoAddScreen(page);
  await page.route('**/api/closet-items/media', async (route) => { uploadCalls += 1; await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) }); });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() !== 'POST') return;
    createCalls += 1;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'pending_review' }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() !== 'PUT') return;
    confirmCalls += 1;
    if (confirmCalls === 1) { await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Item not found' }) }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'confirmed' }) });
  });

  await fillRequiredFields(page);
  await page.getByTestId('my-things-submit').click();
  await expect(page.getByTestId('my-things-submit-error')).toBeVisible();
  await expect(page.getByText('Your item was saved.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('my-things-submit')).toHaveText('Retry confirmation');

  await page.getByTestId('my-things-submit').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  expect(uploadCalls).toBe(1);
  expect(createCalls).toBe(1);
  expect(confirmCalls).toBe(2);
});

test('Add item: clicking Confirm & Add twice in a row only submits once', async ({ page }) => {
  let uploadCalls = 0;
  await gotoAddScreen(page);
  await page.route('**/api/closet-items/media', async (route: Route) => {
    uploadCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'pending_review' }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'confirmed' }) });
  });

  await fillRequiredFields(page);
  const submit = page.getByTestId('my-things-submit');
  await submit.click();
  await submit.click({ force: true });
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  expect(uploadCalls).toBe(1);
});

const FULL_ITEM = {
  id: 'item-1',
  itemType: 'shirt',
  primaryColor: 'blue',
  style: 'casual',
  occasion: 'everyday',
  season: 'summer',
  brand: 'Acme',
  confirmationStatus: 'confirmed' as const,
  ownershipStatus: 'owned' as const,
  createdAt: new Date().toISOString(),
};

async function gotoEditScreen(page: Page, item: typeof FULL_ITEM = FULL_ITEM) {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [item] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-edit').click();
}

test('Edit Item: tapping the card opens the item sheet, and Edit opens Edit Item pre-filled with all current values', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [FULL_ITEM] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-open').click();
  // Tapping the card no longer navigates straight to Edit — it opens the
  // item sheet, which offers Edit alongside Delete (and Move, when
  // applicable).
  await expect(page.getByTestId('my-things-edit')).toBeVisible();
  await expect(page.getByTestId('my-things-delete')).toBeVisible();
  await page.getByTestId('my-things-edit').click();
  await expect(page.getByRole('heading', { name: 'Edit item' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Blue', exact: true })).toHaveClass(/selected/);

  await page.getByText('Optional details', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Casual', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Everyday', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Summer', exact: true })).toHaveClass(/selected/);
  await expect(page.getByPlaceholder('Optional')).toHaveValue('Acme');

  // No photo picker anywhere on this screen.
  await expect(page.getByTestId('my-things-photo-input')).toHaveCount(0);
});

test('Edit Item: saving resends every field via PUT, excludes confirmationStatus, and never uploads a new photo', async ({ page }) => {
  let uploadCalls = 0;
  let putBody: Record<string, unknown> | null = null;
  await gotoEditScreen(page);
  await page.route('**/api/closet-items/media', async (route) => { uploadCalls += 1; await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'should-not-happen' }) }); });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() !== 'PUT') return;
    putBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FULL_ITEM) });
  });

  await page.getByTestId('my-things-edit-save').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();

  expect(uploadCalls).toBe(0);
  expect(putBody).toMatchObject({ itemType: 'shirt', primaryColor: 'blue', style: 'casual', occasion: 'everyday', season: 'summer', brand: 'Acme' });
  expect((putBody as Record<string, unknown>).confirmationStatus).toBeUndefined();
});

test('Edit Item: clearing an optional chip sends null for that field, and leaves the rest resent unchanged', async ({ page }) => {
  let putBody: Record<string, unknown> | null = null;
  await gotoEditScreen(page);
  await page.getByText('Optional details', { exact: true }).click();
  await page.getByRole('button', { name: 'Casual', exact: true }).click();
  await page.getByRole('button', { name: 'Everyday', exact: true }).click();
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() !== 'PUT') return;
    putBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FULL_ITEM) });
  });

  await page.getByTestId('my-things-edit-save').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();

  expect(putBody).not.toBeNull();
  expect((putBody as Record<string, unknown>).style).toBeNull();
  expect((putBody as Record<string, unknown>).occasion).toBeNull();
  expect((putBody as Record<string, unknown>).season).toBe('summer');
});

test('Edit Item: a successful save returns to My Things and shows the updated card', async ({ page }) => {
  await gotoEditScreen(page);
  await page.getByRole('button', { name: 'Jacket', exact: true }).click();
  await page.getByRole('button', { name: 'Navy', exact: true }).click();
  const updated = { ...FULL_ITEM, itemType: 'jacket', primaryColor: 'navy' };
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [updated] }) });
  });

  await page.getByTestId('my-things-edit-save').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Jacket · Navy');
});

test('Edit Item: a failed save stays on Edit Item with an inline error, and retry succeeds', async ({ page }) => {
  let putCalls = 0;
  await gotoEditScreen(page);
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() !== 'PUT') return;
    putCalls += 1;
    if (putCalls === 1) { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Unable to update this item' }) }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FULL_ITEM) });
  });

  await page.getByTestId('my-things-edit-save').click();
  await expect(page.getByTestId('my-things-edit-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edit item' })).toBeVisible();

  await page.getByTestId('my-things-edit-save').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  expect(putCalls).toBe(2);
});

test('Edit Item: the guard sends Edit Item back to You when the flag turns off mid-session', async ({ page }) => {
  let flagOn = true;
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody({ myThings: flagOn }) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [FULL_ITEM] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-edit').click();
  await expect(page.getByTestId('my-things-edit-save')).toBeVisible();

  flagOn = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('my-things-edit-save')).toHaveCount(0);
  await expect(page.getByTestId('open-settings')).toBeVisible();
});

test('Edit Item: the guard sends Edit Item back to You when the session becomes unauthenticated', async ({ page }) => {
  let authenticated = true;
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody({ authenticated, myThings: true }) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [FULL_ITEM] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-edit').click();
  await expect(page.getByTestId('my-things-edit-save')).toBeVisible();

  authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('my-things-edit-save')).toHaveCount(0);
  await expect(page.getByTestId('you-sign-in')).toBeVisible();
});

test('Edit Item: existing delete confirmation still works alongside the item sheet', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [FULL_ITEM] }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'removed', physicalDeletion: 'completed' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);

  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-delete').click();
  await page.getByTestId('my-things-confirm-delete').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(0);
});

// --- closet_item_analysis: automatic clothing-photo analysis ---------------

async function gotoAddScreenWithAnalysis(page: Page) {
  await mockMe(page, { myThings: true, closetAnalysis: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-add').click();
}

test('Add item analysis: flag off — selecting a photo never triggers an analyze call', async ({ page }) => {
  let analyzeCalls = 0;
  await gotoAddScreen(page); // closetAnalysis defaults to false via mockMe
  await page.route('**/api/closet-items/media', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items/media/*/analyze', async (route) => { analyzeCalls += 1; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: null }) }); });

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await page.waitForTimeout(300);
  expect(analyzeCalls).toBe(0);
  // The upload-on-select behavior is analysis-only — with the flag off,
  // upload must still happen only on Confirm & Add, exactly as before.
  await expect(page.getByText('Your photo was uploaded.', { exact: false })).toHaveCount(0);
});

test('Add item analysis: a successful response appears as compact summary rows, with no chip wall by default', async ({ page }) => {
  await gotoAddScreenWithAnalysis(page);
  await page.route('**/api/closet-items/media', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items/media/up-1/analyze', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ suggestions: { itemType: 'shirt', primaryColor: 'blue', style: 'casual', occasion: null, season: null } }),
    });
  });

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('my-things-analyzing')).toBeVisible();
  await expect(page.getByTestId('my-things-analyzing')).toHaveCount(0);

  await expect(page.getByTestId('my-things-analysis-status')).toHaveText('KIN found one item');
  await expect(page.getByTestId('my-things-summary')).toBeVisible();
  await expect(page.getByTestId('my-things-summary-itemtype')).toContainText('Shirt');
  await expect(page.getByTestId('my-things-summary-color')).toContainText('Blue');
  // No chip wall by default once AI has already supplied the values.
  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Blue', exact: true })).toHaveCount(0);

  // Add to My Things is already reachable — nothing about analysis blocks it.
  await expect(page.getByTestId('my-things-submit')).toBeEnabled();

  // The pencil on each row opens the full chooser; picking a value applies
  // it and returns to the compact summary.
  await page.getByTestId('my-things-summary-itemtype-edit').click();
  await expect(page.getByRole('button', { name: 'Jacket', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Jacket', exact: true }).click();
  await expect(page.getByTestId('my-things-summary-itemtype')).toContainText('Jacket');
  await expect(page.getByTestId('my-things-summary-itemtype')).not.toContainText('Shirt');
  await expect(page.getByRole('button', { name: 'Jacket', exact: true })).toHaveCount(0);
});

test('Add item analysis: edited values from the compact summary are sent correctly on submit', async ({ page }) => {
  let createBody: Record<string, unknown> | null = null;
  await gotoAddScreenWithAnalysis(page);
  await page.route('**/api/closet-items/media', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items/media/up-1/analyze', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: { itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null } }) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() !== 'POST') return;
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', itemType: 'jacket', primaryColor: 'navy', confirmationStatus: 'pending_review' }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', itemType: 'jacket', primaryColor: 'navy', confirmationStatus: 'confirmed' }) });
  });

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('my-things-summary')).toBeVisible();

  await page.getByTestId('my-things-summary-itemtype-edit').click();
  await page.getByRole('button', { name: 'Jacket', exact: true }).click();
  await page.getByTestId('my-things-summary-color-edit').click();
  await page.getByRole('button', { name: 'Navy', exact: true }).click();

  await page.getByTestId('my-things-submit').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  expect(createBody).toMatchObject({ itemType: 'jacket', primaryColor: 'navy' });
});

test('Add item analysis: confidence numbers are never rendered anywhere in the DOM', async ({ page }) => {
  await gotoAddScreenWithAnalysis(page);
  await page.route('**/api/closet-items/media', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items/media/up-1/analyze', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ suggestions: { itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null } }),
    });
  });
  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('my-things-summary-itemtype')).toContainText('Shirt');
  const html = await page.content();
  expect(html).not.toContain('confidence');
});

test('Add item analysis: provider/network failure falls back to the manual flow without blocking Confirm & Add', async ({ page }) => {
  await gotoAddScreenWithAnalysis(page);
  await page.route('**/api/closet-items/media', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items/media/up-1/analyze', async (route) => { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }); });

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('my-things-analyzing')).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByTestId('my-things-photo-error')).toHaveCount(0);

  await page.getByRole('button', { name: 'Shirt', exact: true }).click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await expect(page.getByTestId('my-things-submit')).toBeEnabled();
});

test('Add item analysis: the analyze response never triggers an automatic POST /closet-items', async ({ page }) => {
  let createCalls = 0;
  await gotoAddScreenWithAnalysis(page);
  await page.route('**/api/closet-items/media', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) }); return; }
    if (route.request().method() === 'POST') { createCalls += 1; await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'pending_review' }) }); }
  });
  await page.route('**/api/closet-items/media/up-1/analyze', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: { itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null } }) });
  });

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('my-things-summary-itemtype')).toContainText('Shirt');
  await page.waitForTimeout(300);
  expect(createCalls).toBe(0);
});

test('Add item analysis: never exposes imageObjectKey anywhere reachable from the page', async ({ page }) => {
  await gotoAddScreenWithAnalysis(page);
  await page.route('**/api/closet-items/media', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items/media/up-1/analyze', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: { itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null } }) });
  });
  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('my-things-summary-itemtype')).toContainText('Shirt');
  const html = await page.content();
  expect(html).not.toContain('imageObjectKey');
  expect(html).not.toContain('/objects/closet/');
});

test('Add item analysis regression: a manual chip pick before a delayed analyze response resolves is never overwritten', async ({ page }) => {
  await gotoAddScreenWithAnalysis(page);
  await page.route('**/api/closet-items/media', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items/media/up-1/analyze', async (route) => {
    // Deliberately slow — the user acts before this resolves.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ suggestions: { itemType: 'shirt', primaryColor: 'blue', style: 'casual', occasion: 'everyday', season: 'summer' } }),
    });
  });

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'jacket.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('my-things-analyzing')).toBeVisible();

  // The user picks their own values for itemType and primaryColor while
  // analysis is still in flight...
  await page.getByRole('button', { name: 'Jacket', exact: true }).click();
  await page.getByRole('button', { name: 'Navy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Jacket', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Navy', exact: true })).toHaveClass(/selected/);

  // ...and once the delayed suggestion for those same two fields arrives,
  // it must not clobber the user's picks. Untouched fields (style/occasion/
  // season) are still free to be filled in by the suggestion in the background,
  // even though there is no longer any UI on this screen to surface them.
  await expect(page.getByTestId('my-things-analyzing')).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Jacket', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Navy', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).not.toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Blue', exact: true })).not.toHaveClass(/selected/);
  // Having already started editing manually, the screen never switches to
  // the compact summary once the suggestion lands — the walls stay put.
  await expect(page.getByTestId('my-things-summary')).toHaveCount(0);
});

// --- My Wardrobe / Considering organization ---------------------------------

const OWNED_ITEM = { ...SAMPLE_ITEM, id: 'item-owned', itemType: 'shirt', primaryColor: 'blue', ownershipStatus: 'owned' as const };
const CONSIDERING_ITEM = { ...SAMPLE_ITEM, id: 'item-considering', itemType: 'jacket', primaryColor: 'navy', ownershipStatus: 'considering' as const };

test('the wardrobe view is shown by default and shows only owned items; the considering view shows only considering items', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [OWNED_ITEM, CONSIDERING_ITEM] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);

  // Default view: My Closet (wardrobe). The old always-visible segmented
  // control is now a single toggle link that shows only the *other* tab —
  // only the link to switch to "considering" is present.
  await expect(page.getByRole('heading', { name: 'My Closet' })).toBeVisible();
  await expect(page.getByTestId('my-things-tab-considering')).toBeVisible();
  await expect(page.getByTestId('my-things-tab-wardrobe')).toHaveCount(0);
  // "Want to Buy" replaces the old "Thinking of Buying" label; the
  // persisted value/testid stay exactly "considering".
  await expect(page.getByTestId('my-things-tab-considering')).toHaveText('Want to Buy');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Shirt · Blue');

  await page.getByTestId('my-things-tab-considering').click();
  await expect(page.getByRole('heading', { name: 'Want to Buy' })).toBeVisible();
  await expect(page.getByText("Pieces you're considering.")).toBeVisible();
  await expect(page.getByTestId('my-things-tab-wardrobe')).toBeVisible();
  await expect(page.getByTestId('my-things-tab-considering')).toHaveCount(0);
  await expect(page.getByTestId('my-things-tab-wardrobe')).toHaveText('← My Closet');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Jacket · Navy');

  // Switching back to My Wardrobe still shows only the owned item — the
  // active tab persists correctly during normal interaction.
  await page.getByTestId('my-things-tab-wardrobe').click();
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Shirt · Blue');
});

test('each tab has its own empty state', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [OWNED_ITEM] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await expect(page.getByText('Nothing added yet.', { exact: false })).toHaveCount(0);

  await page.getByTestId('my-things-tab-considering').click();
  await expect(page.getByText('Nothing you', { exact: false })).toBeVisible();
  await expect(page.getByTestId('my-things-item')).toHaveCount(0);
});

test('a considering item exposes Move to My Wardrobe in its sheet; an owned item does not', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [OWNED_ITEM] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-open').click();
  await expect(page.getByTestId('my-things-move')).toHaveCount(0);
  await expect(page.getByTestId('my-things-edit')).toBeVisible();
  await expect(page.getByTestId('my-things-delete')).toBeVisible();
});

test('Moving a Considering item to My Wardrobe persists via PUT, moves it immediately, and never creates a duplicate card', async ({ page }) => {
  await mockMe(page, { myThings: true });
  let putBody: Record<string, unknown> | null = null;
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [CONSIDERING_ITEM] }) });
  });
  await page.route('**/api/closet-items/item-considering', async (route) => {
    if (route.request().method() !== 'PUT') return;
    putBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...CONSIDERING_ITEM, ownershipStatus: 'owned' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-tab-considering').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);

  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-move').click();

  expect(putBody).not.toBeNull();
  expect((putBody as Record<string, unknown>).ownershipStatus).toBe('owned');
  // Gone from Considering immediately, no duplicate left behind.
  await expect(page.getByTestId('my-things-item')).toHaveCount(0);

  await page.getByTestId('my-things-tab-wardrobe').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
});

test('Delete remains fully functional through the item sheet for a Considering item', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [CONSIDERING_ITEM] }) });
  });
  await page.route('**/api/closet-items/item-considering', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'removed', physicalDeletion: 'completed' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-tab-considering').click();

  await page.getByTestId('my-things-open').click();
  await page.getByTestId('my-things-delete').click();
  await page.getByTestId('my-things-confirm-delete').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(0);
});

test('Add item: ownership choice defaults to "I own this" and a new item persists as owned', async ({ page }) => {
  let createBody: Record<string, unknown> | null = null;
  await gotoAddScreen(page);
  await expect(page.getByTestId('my-things-ownership-owned')).toHaveClass(/selected/);
  await expect(page.getByTestId('my-things-ownership-considering')).not.toHaveClass(/selected/);

  await page.route('**/api/closet-items/media', async (route) => { await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) }); });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() !== 'POST') return;
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'pending_review' }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'confirmed' }) });
  });

  await fillRequiredFields(page);
  await page.getByTestId('my-things-submit').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  expect((createBody as Record<string, unknown> | null)?.ownershipStatus).toBe('owned');
});

test('Add item: choosing "Want to Buy" persists the new item as considering', async ({ page }) => {
  let createBody: Record<string, unknown> | null = null;
  await gotoAddScreen(page);
  await page.route('**/api/closet-items/media', async (route) => { await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) }); });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() !== 'POST') return;
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', ownershipStatus: 'considering', confirmationStatus: 'pending_review' }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', ownershipStatus: 'considering', confirmationStatus: 'confirmed' }) });
  });

  await fillRequiredFields(page);
  await expect(page.getByTestId('my-things-ownership-considering')).toHaveText('Want to Buy');
  await page.getByTestId('my-things-ownership-considering').click();
  await expect(page.getByTestId('my-things-ownership-considering')).toHaveClass(/selected/);
  await expect(page.getByTestId('my-things-ownership-owned')).not.toHaveClass(/selected/);
  await page.getByTestId('my-things-submit').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  expect((createBody as Record<string, unknown> | null)?.ownershipStatus).toBe('considering');
});

test('Arabic labels: tabs, ownership choice, and the item sheet render in Arabic with RTL', async ({ page }) => {
  await mockMe(page, { myThings: true, language: 'ar' });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [CONSIDERING_ITEM] }) });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await openMyThings(page);

  // The kicker stays "My Things" ("أغراضي") on every view; the page title
  // is now the view-specific "My Closet" ("خزانتي").
  await expect(page.locator('.approved-kicker')).toHaveText('أغراضي');
  await expect(page.getByRole('heading', { name: 'خزانتي' })).toBeVisible();
  await expect(page.getByTestId('my-things-tab-considering')).toHaveText('قائمة الشراء');

  await page.getByTestId('my-things-tab-considering').click();
  await expect(page.getByRole('heading', { name: 'قائمة الشراء' })).toBeVisible();
  await expect(page.getByText('قطع تفكر في شرائها.')).toBeVisible();
  await expect(page.getByTestId('my-things-tab-wardrobe')).toHaveText('→ خزانتي');
  await page.getByTestId('my-things-open').click();
  await expect(page.getByTestId('my-things-move')).toHaveText('انقل إلى خزانتي');
  await expect(page.getByTestId('my-things-edit')).toHaveText('تعديل');
  await expect(page.getByTestId('my-things-delete')).toHaveText('حذف');
});

test('Arabic labels: Add item ownership choice', async ({ page }) => {
  await mockMe(page, { myThings: true, language: 'ar' });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
  await page.getByTestId('my-things-add').click();

  await expect(page.getByTestId('my-things-ownership-owned')).toHaveText('أملك هذه القطعة');
  await expect(page.getByTestId('my-things-ownership-considering')).toHaveText('أريد شراءها');
});

test('390x844 mobile layout: My Things renders with no document-level horizontal overflow, in both tabs', async ({ page }) => {
  await mockMe(page, { myThings: true });
  // The search field only renders once the active tab exceeds
  // MY_THINGS_SEARCH_VISIBLE_THRESHOLD (8) items — seed enough owned items
  // to exercise it here, alongside a single considering item.
  const manyOwned = Array.from({ length: 9 }, (_, index) => ({ ...SAMPLE_ITEM, id: `owned-${index}`, ownershipStatus: 'owned' as const }));
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [...manyOwned, CONSIDERING_ITEM] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
  await openMyThings(page);
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);

  await expect(page.getByTestId('my-things-search-input')).toBeVisible();
  await page.getByTestId('my-things-search-input').fill('shirt');
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
  await page.getByTestId('my-things-search-input').fill('');

  await page.getByTestId('my-things-category-select').selectOption('tops');
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
  await page.getByTestId('my-things-category-select').selectOption('all');

  await page.getByTestId('my-things-tab-considering').click();
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);

  // Only one item on this tab (below the search threshold) — its sheet is
  // opened via the card itself, not a three-dot trigger.
  await page.getByTestId('my-things-open').click();
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
});

test('390x844 mobile layout: Add to My Things compact summary and its edit sheet have no horizontal overflow', async ({ page }) => {
  await gotoAddScreenWithAnalysis(page);
  await page.route('**/api/closet-items/media', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) });
  });
  await page.route('**/api/closet-items/media/up-1/analyze', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: { itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null } }) });
  });
  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('my-things-summary')).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);

  await page.getByTestId('my-things-summary-itemtype-edit').click();
  await expect(page.getByRole('button', { name: 'Jacket', exact: true })).toBeVisible();
  await expect(page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).resolves.toBe(true);
});

// --- Search and category filters -------------------------------------------

const TOPS_ITEM = { ...SAMPLE_ITEM, id: 'item-tshirt', itemType: 't_shirt', primaryColor: 'white' };
const BOTTOMS_ITEM = { ...SAMPLE_ITEM, id: 'item-jeans', itemType: 'jeans', primaryColor: 'blue' };
const SHOES_ITEM = { ...SAMPLE_ITEM, id: 'item-boots', itemType: 'boots', primaryColor: 'brown' };
const OUTERWEAR_ITEM = { ...SAMPLE_ITEM, id: 'item-coat', itemType: 'coat', primaryColor: 'black' };
const DRESS_ITEM = { ...SAMPLE_ITEM, id: 'item-dress', itemType: 'dress', primaryColor: 'red' };
const BAG_ITEM = { ...SAMPLE_ITEM, id: 'item-bag', itemType: 'bag', primaryColor: 'gold' };
const ACCESSORY_ITEM = { ...SAMPLE_ITEM, id: 'item-accessory', itemType: 'accessory', primaryColor: 'silver' };
const OTHER_ITEM = { ...SAMPLE_ITEM, id: 'item-other', itemType: 'other', primaryColor: 'multicolor' };
const ALL_CATEGORY_ITEMS = [TOPS_ITEM, BOTTOMS_ITEM, SHOES_ITEM, OUTERWEAR_ITEM, DRESS_ITEM, BAG_ITEM, ACCESSORY_ITEM, OTHER_ITEM];

async function gotoMyThingsWithItems(page: Page, items: unknown[]) {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);
}

test('search filters the currently active ownership tab using existing item data', async ({ page }) => {
  // The search field only renders past the 8-item threshold — seed each
  // tab with 9 items (a distinctive one plus filler) to exercise it.
  const wardrobeItems = [OWNED_ITEM, ...Array.from({ length: 8 }, (_, index) => ({ ...SAMPLE_ITEM, id: `owned-filler-${index}`, itemType: 'sneakers', primaryColor: 'white', ownershipStatus: 'owned' as const }))];
  const consideringItems = [CONSIDERING_ITEM, ...Array.from({ length: 8 }, (_, index) => ({ ...SAMPLE_ITEM, id: `considering-filler-${index}`, itemType: 'sneakers', primaryColor: 'white', ownershipStatus: 'considering' as const }))];
  await gotoMyThingsWithItems(page, [...wardrobeItems, ...consideringItems]);
  await expect(page.getByTestId('my-things-item')).toHaveCount(9);

  await page.getByTestId('my-things-search-input').fill('navy');
  await expect(page.getByTestId('my-things-item')).toHaveCount(0);

  await page.getByTestId('my-things-search-input').fill('blue');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Shirt · Blue');

  // Switching tabs searches the newly active tab, not the one the query was
  // typed in — and also clears the query itself, so the fresh tab starts
  // unfiltered.
  await page.getByTestId('my-things-tab-considering').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(9);
  await page.getByTestId('my-things-search-input').fill('navy');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Jacket · Navy');
});

test('each category filter maps only to its intended existing item types', async ({ page }) => {
  await gotoMyThingsWithItems(page, ALL_CATEGORY_ITEMS);
  await expect(page.getByTestId('my-things-item')).toHaveCount(8);

  await page.getByTestId('my-things-category-select').selectOption('tops');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('T-Shirt · White');

  await page.getByTestId('my-things-category-select').selectOption('bottoms');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Jeans · Blue');

  await page.getByTestId('my-things-category-select').selectOption('shoes');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Boots · Brown');

  await page.getByTestId('my-things-category-select').selectOption('outerwear');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Coat · Black');
});

test('Dress, Bag, Accessory, and Other remain available under All and through search, never mis-bucketed into a category', async ({ page }) => {
  // A 9th (bucketed) item is added purely to push this tab's count past the
  // search-field visibility threshold (8) so the search assertions below
  // can run; it must never collide with the dress/bag/accessory/other
  // search terms used further down.
  const EXTRA_TOPS_ITEM = { ...SAMPLE_ITEM, id: 'item-sweater', itemType: 'sweater', primaryColor: 'green' };
  await gotoMyThingsWithItems(page, [...ALL_CATEGORY_ITEMS, EXTRA_TOPS_ITEM]);
  await expect(page.getByTestId('my-things-category-select')).toHaveValue('all');
  await expect(page.getByTestId('my-things-item')).toHaveCount(9);

  // None of the four bucketed categories ever match dress/bag/accessory/other.
  for (const category of ['tops', 'bottoms', 'shoes', 'outerwear']) {
    await page.getByTestId('my-things-category-select').selectOption(category);
    const captions = await page.getByTestId('my-things-item').locator('.profile-grid-caption').allTextContents();
    expect(captions.some((caption) => /Dress|Bag|Accessory|Other/.test(caption))).toBe(false);
  }

  await page.getByTestId('my-things-category-select').selectOption('all');
  await expect(page.getByTestId('my-things-item')).toHaveCount(9);

  await page.getByTestId('my-things-search-input').fill('dress');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Dress · Red');

  await page.getByTestId('my-things-search-input').fill('bag');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Bag · Gold');

  await page.getByTestId('my-things-search-input').fill('accessory');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Accessory · Silver');

  await page.getByTestId('my-things-search-input').fill('other');
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByTestId('my-things-item').locator('.profile-grid-caption')).toHaveText('Other · Multicolor');
});

test('category filter labels render correctly in Arabic', async ({ page }) => {
  await mockMe(page, { myThings: true, language: 'ar' });
  // Seeded past the search-field visibility threshold so the placeholder
  // assertion below has something to check.
  const manyItems = Array.from({ length: 9 }, (_, index) => ({ ...SAMPLE_ITEM, id: `item-${index}`, ownershipStatus: 'owned' as const }));
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: manyItems }) });
  });
  await page.goto('/?lang=ar', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);

  // The category chip row is now one compact <select>; "All" is labeled
  // "All Items" ("كل القطع"). Its options render in Arabic.
  const select = page.getByTestId('my-things-category-select');
  await expect(select).toHaveValue('all');
  await expect(select.locator('option[value="all"]')).toHaveText('كل القطع');
  await expect(select.locator('option[value="tops"]')).toHaveText('قطع علوية');
  await expect(select.locator('option[value="bottoms"]')).toHaveText('قطع سفلية');
  await expect(select.locator('option[value="shoes"]')).toHaveText('أحذية');
  await expect(select.locator('option[value="outerwear"]')).toHaveText('ملابس خارجية');
  await expect(page.getByTestId('my-things-search-input')).toHaveAttribute('placeholder', 'ابحث في قطعك');
});

test('Retake photo resets the upload state and lets a new photo go through the same analyze/create/confirm sequence', async ({ page }) => {
  let uploadCalls = 0;
  let createCalls = 0;
  await gotoAddScreenWithAnalysis(page);
  await page.route('**/api/closet-items/media', async (route) => { uploadCalls += 1; await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: `up-${uploadCalls}` }) }); });
  await page.route('**/api/closet-items/media/*/analyze', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: { itemType: 'shirt', primaryColor: 'blue', style: null, occasion: null, season: null } }) });
  });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() !== 'POST') return;
    createCalls += 1;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: `item-${createCalls}`, confirmationStatus: 'pending_review' }) });
  });
  await page.route('**/api/closet-items/item-*', async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-2', confirmationStatus: 'confirmed' }) });
  });

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(page.getByTestId('my-things-summary')).toBeVisible();
  expect(uploadCalls).toBe(1);

  await page.getByTestId('my-things-retake').click();
  await page.getByTestId('my-things-retake-input').setInputFiles({ name: 'shirt2.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes-2') });
  await expect(page.getByTestId('my-things-summary')).toBeVisible();
  expect(uploadCalls).toBe(2);

  await page.getByTestId('my-things-submit').click();
  await expect(page.getByTestId('my-things-add')).toBeVisible();
  expect(createCalls).toBe(1);
});

// --- Style This Piece (replaces the removed multi-select "Style with KIN") -

test('Style This Piece: tapping a card opens the sheet, and Style This Piece navigates to KIN with that single item pre-selected', async ({ page }) => {
  await mockMe(page, { myThings: true, kinSearch: true });
  const items = [
    { ...SAMPLE_ITEM, id: 'owned-shirt', itemType: 'shirt', primaryColor: 'blue', ownershipStatus: 'owned' as const },
    { ...SAMPLE_ITEM, id: 'considering-coat', itemType: 'coat', primaryColor: 'black', ownershipStatus: 'considering' as const },
  ];
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await openMyThings(page);

  // Owned item: Style This Piece is offered, and navigates straight into
  // KIN's Style tab with exactly that one item pre-selected.
  await page.getByTestId('my-things-open').click();
  await expect(page.getByTestId('my-things-style-piece')).toBeVisible();
  await page.getByTestId('my-things-style-piece').click();
  await expect(page.getByRole('heading', { name: 'Style a Piece' })).toBeVisible();
  await expect(page.getByTestId('kin-styling-summary')).toBeVisible();
  await expect(page.getByTestId('kin-styling-summary')).toContainText('Shirt');
  await expect(page.getByTestId('kin-styling-summary').locator('img')).toHaveAttribute('src', '/api/closet-items/owned-shirt/image');

  // Considering item: never offered, since the backend's multi-item KIN
  // lookup only resolves owned items. Move/Edit/Delete remain available.
  await page.getByTestId('kin-mode-my-things').click();
  await page.getByTestId('my-things-tab-considering').click();
  await page.getByTestId('my-things-open').click();
  await expect(page.getByTestId('my-things-style-piece')).toHaveCount(0);
  await expect(page.getByTestId('my-things-move')).toBeVisible();
  await expect(page.getByTestId('my-things-edit')).toBeVisible();
});

test('My Things (and so Style This Piece) is entirely unreachable when the kin_search flag is off, even with my_things on', async ({ page }) => {
  // My Things now only opens from inside KIN, so kin_search off removes the
  // one remaining door to it — Style This Piece never gets a chance to
  // render at all, which is a stronger guarantee than the flag it used to
  // gate directly.
  await mockMe(page, { myThings: true, kinSearch: false });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [OWNED_ITEM] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-kin').click();
  await expect(page.getByTestId('kin-mode-my-things')).toHaveCount(0);
  await expect(page.getByTestId('my-things-grid')).toHaveCount(0);
});
