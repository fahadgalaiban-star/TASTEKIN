import { expect, test, type Page, type Route } from '@playwright/test';

type MeOptions = { authenticated?: boolean; myThings?: boolean };

function meBody({ authenticated = true, myThings = true }: MeOptions = {}) {
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
    featureFlags: { my_things: myThings },
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

test('Add item: Confirm & Add stays disabled until a photo and all required fields are chosen', async ({ page }) => {
  await gotoAddScreen(page);
  const submit = page.getByTestId('my-things-submit');
  await expect(submit).toBeDisabled();

  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await expect(submit).toBeDisabled();

  await page.getByRole('button', { name: 'Shirt', exact: true }).click();
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Casual', exact: true }).click();
  await expect(submit).toBeEnabled();
});

async function fillRequiredFields(page: Page) {
  await page.getByTestId('my-things-photo-input').setInputFiles({ name: 'shirt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes') });
  await page.getByRole('button', { name: 'Shirt', exact: true }).click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await page.getByRole('button', { name: 'Casual', exact: true }).click();
}

test('Add item: the full upload -> create -> confirm sequence runs in order with the right payloads', async ({ page }) => {
  const calls: string[] = [];
  await gotoAddScreen(page);
  await page.route('**/api/closet-items/media', async (route) => { calls.push('upload'); await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ uploadId: 'up-1' }) }); });
  await page.route('**/api/closet-items', async (route) => {
    if (route.request().method() !== 'POST') return;
    calls.push('create');
    const body = route.request().postDataJSON() as { uploadId: string; confirmationStatus?: string };
    expect(body.uploadId).toBe('up-1');
    expect(body.confirmationStatus).toBeUndefined();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...SAMPLE_ITEM, id: 'item-1', confirmationStatus: 'pending_review' }) });
  });
  await page.route('**/api/closet-items/item-1', async (route) => {
    if (route.request().method() !== 'PUT') return;
    calls.push('confirm');
    const body = route.request().postDataJSON() as { confirmationStatus: string; itemType: string };
    expect(body.confirmationStatus).toBe('confirmed');
    expect(body.itemType).toBe('shirt');
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
