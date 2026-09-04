import { expect, test, type Page, type Route } from '@playwright/test';

type MeOptions = { authenticated?: boolean; myThings?: boolean; closetAnalysis?: boolean };

function meBody({ authenticated = true, myThings = true, closetAnalysis = false }: MeOptions = {}) {
  return JSON.stringify({
    user: authenticated ? { id: 'my-things-e2e-user', email: 'my-things-e2e@tastekin.test' } : null,
    role: 'consumer',
    creator: null,
    isAdmin: false,
    language: 'en',
    notifyPush: true,
    notifyEmail: true,
    subscribed: false,
    supportEmail: null,
    needsOnboarding: false,
    onboardingStep: 'done',
    googleAuthConfigured: false,
    featureFlags: { my_things: myThings, closet_item_analysis: closetAnalysis },
  });
}

async function mockMe(page: Page, options: MeOptions = {}) {
  await page.route('**/api/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: meBody(options) });
  });
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
  createdAt: new Date().toISOString(),
};

test('You screen only offers My Things when the my_things flag is on', async ({ page }) => {
  await mockMe(page, { myThings: false });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await expect(page.getByTestId('open-my-things')).toHaveCount(0);
});

test('You screen offers My Things when the flag is on, and it opens the screen', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await expect(page.getByTestId('open-my-things')).toBeVisible();
  await page.getByTestId('open-my-things').click();
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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();

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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
});

test('delete: 200 completed and 202 pending are both treated as removed', async ({ page }) => {
  await mockMe(page, { myThings: true });
  const items = [{ ...SAMPLE_ITEM, id: 'item-completed' }, { ...SAMPLE_ITEM, id: 'item-pending' }];
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items }) });
  });
  await page.route('**/api/closet-items/item-completed', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'removed', physicalDeletion: 'completed' }) });
  });
  await page.route('**/api/closet-items/item-pending', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'removed', physicalDeletion: 'pending' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(2);

  const cards = page.getByTestId('my-things-item');
  await cards.nth(0).getByTestId('my-things-delete').click();
  await cards.nth(0).getByTestId('my-things-confirm-delete').click();
  await expect(page.getByTestId('my-things-item')).toHaveCount(1);
  await expect(page.getByText('Removed.', { exact: true })).toBeVisible();

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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await page.getByTestId('my-things-add').click();
}

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
  // As of PR-3, style is optional (moved into "Optional details") — the
  // button must already be enabled here, without ever touching style.
  await expect(submit).toBeEnabled();
});

test('Add item: style remains available but optional inside Optional details, and can be picked without blocking the others', async ({ page }) => {
  await gotoAddScreen(page);
  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await page.getByRole('button', { name: 'Shirt', exact: true }).click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  const submit = page.getByTestId('my-things-submit');
  await expect(submit).toBeEnabled();

  await page.getByText('Optional details', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Casual', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Casual', exact: true }).click();
  await expect(submit).toBeEnabled();
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
  createdAt: new Date().toISOString(),
};

async function gotoEditScreen(page: Page, item: typeof FULL_ITEM = FULL_ITEM) {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [item] }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await page.getByTestId('my-things-open').click();
}

test('Edit Item: tapping the card photo/caption opens Edit Item, pre-filled with all current values', async ({ page }) => {
  await gotoEditScreen(page);
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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await page.getByTestId('my-things-open').click();
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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await page.getByTestId('my-things-open').click();
  await expect(page.getByTestId('my-things-edit-save')).toBeVisible();

  authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('my-things-edit-save')).toHaveCount(0);
  await expect(page.getByTestId('you-sign-in')).toBeVisible();
});

test('Edit Item: existing delete confirmation still works alongside the new open-for-edit affordance', async ({ page }) => {
  await mockMe(page, { myThings: true });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [FULL_ITEM] }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'removed', physicalDeletion: 'completed' }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();

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
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-my-things').click();
  await page.getByTestId('my-things-add').click();
}

function occasionField(page: Page) { return page.locator('.form-field').filter({ hasText: 'Occasion' }); }
function seasonField(page: Page) { return page.locator('.form-field').filter({ hasText: 'Season' }); }

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

test('Add item analysis: a successful response preselects the returned chips, and every chip stays tappable/clearable', async ({ page }) => {
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

  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Blue', exact: true })).toHaveClass(/selected/);
  await page.getByText('Optional details', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Casual', exact: true })).toHaveClass(/selected/);
  // occasion/season came back null — left unselected, not defaulted to anything.
  await expect(occasionField(page).locator('button.selected')).toHaveCount(0);
  await expect(seasonField(page).locator('button.selected')).toHaveCount(0);

  // Confirm & Add is already reachable — nothing about analysis blocks it.
  await expect(page.getByTestId('my-things-submit')).toBeEnabled();

  // Every preselected chip remains tappable and clearable, same as manual entry.
  await page.getByRole('button', { name: 'Jacket', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Jacket', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).not.toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Casual', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Casual', exact: true })).not.toHaveClass(/selected/);
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
  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).toHaveClass(/selected/);
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
  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).toHaveClass(/selected/);
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
  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).toHaveClass(/selected/);
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
  // season) are still free to be filled in by the suggestion.
  await expect(page.getByTestId('my-things-analyzing')).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Jacket', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Navy', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Shirt', exact: true })).not.toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Blue', exact: true })).not.toHaveClass(/selected/);

  await page.getByText('Optional details', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Casual', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Everyday', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Summer', exact: true })).toHaveClass(/selected/);
});
