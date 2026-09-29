import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';

// Collection management, owner side, at a 390×844 phone viewport:
//  1. "Create new collection" inside the post composer's collection picker —
//     title, optional Arabic title and description — saves the collection
//     immediately and selects it for the post being written; publishing then
//     links the post to it.
//  2. "Delete collection" on the owner's collection edit screen, behind a
//     confirmation. Only the collection goes: its posts keep their media and
//     status and are merely unlinked, no media cleanup is ever requested,
//     and a Featured collection is removed from the featured list. The demo
//     collections (Quiet Luxury, The Coastal Edit) are deletable like any.

const ownerSession = 'tastekin-e2e-owner';
const imagePath = path.resolve(import.meta.dirname, '../public/tastekin-media/coastal-notes.webp');
const onePixelImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==', 'base64');

type Edit = { id: string; category: string; title: string; titleAr: string; caption: string; captionAr: string; image?: string; sourceImage?: string; location: string; locationAr: string; altText: string; access: 'public'; status: 'draft' | 'published' | 'archived'; collectionIds: string[] };
type Collection = { id: string; title: string; titleAr: string; description: string; descriptionAr: string; access: 'public'; coverEditId: string; coverImage?: string; coverImageObjectPath?: string | null; editIds: string[]; uploads?: Array<{ id: string; type: string; image: string }>; itemOrder?: string[] };
type Workspace = { creatorId: string; revision: number; updatedAt: string; edits: Edit[]; collections: Collection[] };

function makeEdit(id: string, title: string, image: string, collectionIds: string[]): Edit {
  return { id, category: 'Fashion', title, titleAr: title, caption: title, captionAr: title, image, location: 'Kuwait City, Kuwait', locationAr: 'مدينة الكويت، الكويت', altText: title, access: 'public', status: 'published', collectionIds };
}

class WorkspaceApi {
  workspace: Workspace = {
    creatorId: 'fheed', revision: 4, updatedAt: '2026-09-01T00:00:00.000Z',
    edits: [
      makeEdit('quiet-tailoring', 'Quiet tailoring', '/tastekin-media/quiet-tailoring.webp', ['quiet-luxury']),
      makeEdit('coastal-notes', 'Coastal notes', '/tastekin-media/coastal-notes.webp', ['coastal-edit']),
      makeEdit('sunday-reset', 'Sunday reset', '/objects/uploads/11111111-1111-4111-8111-111111111111', ['coastal-edit', 'quiet-luxury']),
    ],
    collections: [
      { id: 'quiet-luxury', title: 'Quiet Luxury', titleAr: 'فخامة هادئة', description: 'Tailoring and calm.', descriptionAr: 'خياطة وهدوء.', access: 'public', coverEditId: 'quiet-tailoring', editIds: ['quiet-tailoring', 'sunday-reset'] },
      { id: 'coastal-edit', title: 'The Coastal Edit', titleAr: 'اختيارات الساحل', description: 'Places, packing and travel notes.', descriptionAr: 'أماكن وحقائب وملاحظات سفر.', access: 'public', coverEditId: 'coastal-notes', editIds: ['coastal-notes', 'sunday-reset'], uploads: [{ id: 'upload-1', type: 'photo', image: '/objects/uploads/22222222-2222-4222-8222-222222222222' }], itemOrder: ['coastal-notes', 'sunday-reset', 'upload-1'] },
    ],
  };
  featured: string[] = ['quiet-luxury', 'coastal-edit'];
  readonly savedPayloads: Array<{ edits: Edit[]; collections: Collection[]; expectedRevision: number }> = [];
  readonly featuredPayloads: string[][] = [];
  readonly cleanupRequests: string[][] = [];
  readonly objectPaths: string[] = [];
  private uploadNumber = 0;
  constructor(private language: 'en' | 'ar' = 'en') {}

  async attach(page: Page) {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'uploads.tastekin.test') { await route.fulfill({ status: route.request().method() === 'PUT' ? 204 : 405 }); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      await this.handle(route, url);
    });
  }

  private owner(route: Route) { return route.request().headers().cookie?.includes(`sid=${ownerSession}`) ?? false; }
  private body(route: Route) { const raw = route.request().postData(); return raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
  private async image(route: Route) { await route.fulfill({ status: 200, contentType: 'image/png', body: onePixelImage }); }

  private async handle(route: Route, url: URL) {
    const method = route.request().method();
    const owner = this.owner(route);
    if (url.pathname === '/api/me') {
      await route.fulfill({ json: owner
        ? { user: { id: 'fheed-owner', email: 'founder@tastekin.test' }, role: 'creator', creator: { id: 'fheed', handle: 'fheed', displayName: 'Fheed Alaiban', verified: true, ownsWorkspace: true }, isAdmin: false, language: this.language, featureFlags: {}, needsOnboarding: false, onboardingStep: 'done' }
        : { user: null, role: 'consumer', creator: null, isAdmin: false, language: this.language, featureFlags: {} } });
      return;
    }
    if (url.pathname === '/api/creator-workspace' || url.pathname === '/api/creators/fheed/workspace') {
      if (method === 'GET') { await route.fulfill({ json: this.workspace }); return; }
      if (method === 'PUT') {
        if (!owner) { await route.fulfill({ status: 401, json: { error: 'Sign in' } }); return; }
        const payload = this.body(route) as { edits: Edit[]; collections: Collection[]; expectedRevision: number };
        if (payload.expectedRevision !== this.workspace.revision) { await route.fulfill({ status: 409, json: { error: 'Creator workspace changed on another device. Reload before saving.' } }); return; }
        this.savedPayloads.push(payload);
        this.workspace = { ...this.workspace, edits: payload.edits, collections: payload.collections, revision: this.workspace.revision + 1, updatedAt: new Date().toISOString() };
        // Mirrors the server: a deleted collection is dropped from Featured in the same save.
        this.featured = this.featured.filter((id) => payload.collections.some((collection) => collection.id === id));
        await route.fulfill({ json: this.workspace });
        return;
      }
    }
    if (url.pathname === '/api/creator-profile' || url.pathname === '/api/creators/fheed') {
      await route.fulfill({ json: { displayName: 'Fheed Alaiban', username: 'fheed', bio: 'A considered edit.', city: 'Kuwait City', country: 'Kuwait', interests: ['Fashion', 'Travel', 'Places'], avatar: '/tastekin-media/fheed-profile.webp', avatarObjectPath: null, coverImage: '', coverImageObjectPath: null, age: null, dateOfBirth: null, showAge: false, verified: true, revision: this.workspace.revision } });
      return;
    }
    if (url.pathname === '/api/creator-featured-collections' || url.pathname === '/api/creators/fheed/featured-collections') {
      if (method === 'PUT') {
        const ids = (this.body(route).collectionIds as string[]) ?? [];
        if (ids.some((id) => !this.workspace.collections.some((collection) => collection.id === id))) { await route.fulfill({ status: 400, json: { error: 'A featured collection is not part of this workspace' } }); return; }
        this.featuredPayloads.push(ids); this.featured = ids;
      }
      await route.fulfill({ json: { collectionIds: this.featured } });
      return;
    }
    if (url.pathname === '/api/storage/uploads/request-url') {
      const objectPath = `/objects/uploads/composer-${++this.uploadNumber}`;
      this.objectPaths.push(objectPath);
      await route.fulfill({ json: { uploadURL: `https://uploads.tastekin.test/upload${objectPath}`, objectPath, metadata: this.body(route) } });
      return;
    }
    if (url.pathname === '/api/storage/uploads/cleanup') { this.cleanupRequests.push(this.body(route).objectPaths as string[]); await route.fulfill({ status: 204 }); return; }
    if (url.pathname.startsWith('/api/storage/objects/') || url.pathname.startsWith('/api/public-media/') || url.pathname.startsWith('/api/public-profile-media')) { await this.image(route); return; }
    if (url.pathname === '/api/public-feed') { await route.fulfill({ json: { items: [] } }); return; }
    await route.fulfill({ status: 404, json: { error: 'Not found' } });
  }
}

async function ownerPage(page: Page, api: WorkspaceApi) {
  await page.context().addCookies([{ name: 'sid', value: ownerSession, url: 'http://127.0.0.1:23385' }]);
  await api.attach(page);
  await page.goto('/');
  await page.getByTestId('nav-you').click();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function shot(page: Page, name: string) {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` });
}

test.use({ viewport: { width: 390, height: 844 } });

test('composer: "Create new collection" beside the collection choices saves the collection, selects it for the post, and publishing links the post to it', async ({ page }) => {
  const api = new WorkspaceApi();
  await ownerPage(page, api);
  await page.getByTestId('open-creator-workspace').click();
  await expect(page.getByRole('heading', { name: 'Create an Edit' })).toBeVisible();

  // A photo for the post, cropped the ordinary way.
  await page.locator('input[type="file"]').setInputFiles(imagePath);
  await expect(page.locator('[aria-label="Crop image"]')).toBeVisible();
  await page.getByRole('button', { name: 'Post Portrait' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Create an Edit' })).toBeVisible();
  await page.locator('textarea.unified-caption-input').fill('Weekend reset');
  await page.getByRole('radio', { name: 'Style', exact: true }).click();

  // The existing choices are still there, with "Create new collection" beside them.
  await page.getByRole('button', { name: /Add to a collection/ }).click();
  const choices = page.locator('.collection-checks');
  await expect(choices.getByRole('button', { name: 'Quiet Luxury', exact: true })).toBeVisible();
  await expect(choices.getByRole('button', { name: 'The Coastal Edit', exact: true })).toBeVisible();
  await expect(page.getByTestId('composer-create-collection')).toBeVisible();
  await page.getByTestId('composer-create-collection').click();

  const form = page.getByTestId('composer-new-collection');
  await expect(form).toBeVisible();
  await expect(page.getByTestId('composer-create-collection-save')).toBeDisabled();
  await form.getByLabel('Title', { exact: true }).fill('Slow Mornings');
  await form.getByLabel('Arabic title (optional)').fill('صباحات هادئة');
  await form.getByLabel('Description (optional)').fill('Coffee, light and quiet streets.');
  await expectNoHorizontalOverflow(page);
  await shot(page, 'composer-create-collection');
  await page.getByTestId('composer-create-collection-save').click();

  // Saved immediately, selected for this post, picker closed.
  await expect(form).toHaveCount(0);
  await expect(choices).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Slow Mornings/ })).toBeVisible();
  expect(api.savedPayloads).toHaveLength(1);
  const created = api.savedPayloads[0].collections[0];
  expect(created).toMatchObject({ title: 'Slow Mornings', titleAr: 'صباحات هادئة', description: 'Coffee, light and quiet streets.', access: 'public', editIds: [] });
  expect(api.savedPayloads[0].collections.map((collection) => collection.id)).toEqual([created.id, 'quiet-luxury', 'coastal-edit']);
  // The post itself is still unsaved: the workspace's edits are untouched.
  expect(api.savedPayloads[0].edits.map((edit) => edit.id)).toEqual(['quiet-tailoring', 'coastal-notes', 'sunday-reset']);

  // Reopening the picker shows the new collection selected among the choices.
  await page.getByRole('button', { name: /Slow Mornings/ }).click();
  await expect(choices.getByRole('button', { name: 'Slow Mornings' }).locator('.lucide-check')).toHaveCount(1);
  await page.getByRole('button', { name: /Slow Mornings/ }).first().click();

  // Publishing links the post to the new collection.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByTestId('open-creator-workspace')).toBeVisible();
  const published = api.savedPayloads.at(-1)!;
  const post = published.edits.find((edit) => edit.caption === 'Weekend reset');
  expect(post?.status).toBe('published');
  expect(post?.collectionIds).toEqual([created.id]);
  expect(published.collections.find((collection) => collection.id === created.id)?.editIds).toEqual([post!.id]);
  expect(published.collections.find((collection) => collection.id === 'quiet-luxury')?.editIds).toEqual(['quiet-tailoring', 'sunday-reset']);
});

test('composer: the Arabic title and description are optional — the Arabic title falls back to the title', async ({ page }) => {
  const api = new WorkspaceApi();
  await ownerPage(page, api);
  await page.getByTestId('open-creator-workspace').click();
  await page.getByRole('button', { name: /Add to a collection/ }).click();
  await page.getByTestId('composer-create-collection').click();
  await page.getByTestId('composer-new-collection').getByLabel('Title', { exact: true }).fill('Field Notes');
  await page.getByTestId('composer-create-collection-save').click();
  await expect(page.getByRole('button', { name: /Field Notes/ })).toBeVisible();
  expect(api.savedPayloads.at(-1)!.collections[0]).toMatchObject({ title: 'Field Notes', titleAr: 'Field Notes', description: '', descriptionAr: '', access: 'public', editIds: [] });
});

test('composer: a failed save keeps the form open with an error and selects nothing', async ({ page }) => {
  const api = new WorkspaceApi();
  await ownerPage(page, api);
  await page.getByTestId('open-creator-workspace').click();
  await page.getByRole('button', { name: /Add to a collection/ }).click();
  await page.getByTestId('composer-create-collection').click();
  await page.getByTestId('composer-new-collection').getByLabel('Title', { exact: true }).fill('Will not save');
  api.workspace = { ...api.workspace, revision: api.workspace.revision + 7 }; // forces a 409 on the next save
  await page.getByTestId('composer-create-collection-save').click();
  await expect(page.getByTestId('composer-new-collection').getByRole('alert')).toContainText('could not be created');
  await expect(page.getByTestId('composer-new-collection')).toBeVisible();
  expect(api.savedPayloads).toHaveLength(0);
});

async function openOwnCollection(page: Page, title: string) {
  await page.getByRole('button', { name: 'View profile' }).click();
  await page.getByRole('button', { name: 'Collections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
  await page.locator('button.approved-collection', { hasText: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await expect(page.getByRole('heading', { name: 'Edit details' })).toBeVisible();
}

test('owner collection edit screen: "Delete collection" asks first, then removes only the collection — posts keep their media, are unlinked, nothing is cleaned up, and Featured is updated', async ({ page }) => {
  const api = new WorkspaceApi();
  await ownerPage(page, api);
  await openOwnCollection(page, 'The Coastal Edit');

  await expect(page.getByTestId('collection-delete-button')).toBeVisible();
  await expect(page.getByTestId('collection-delete-confirm')).toHaveCount(0);
  await page.getByTestId('collection-delete-button').click();
  const confirm = page.getByTestId('collection-delete-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Delete “The Coastal Edit”?');
  await expect(confirm).toContainText('Its posts and photos stay on your profile and are not deleted.');
  await expectNoHorizontalOverflow(page);
  await shot(page, 'collection-delete-confirm');
  // Cancel keeps everything.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(api.savedPayloads).toHaveLength(0);

  await page.getByTestId('collection-delete-button').click();
  await page.getByTestId('collection-delete-confirm-button').click();

  // Back on the owner's collection list, without it.
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
  await expect(page.locator('.workspace-collection-link', { hasText: 'Quiet Luxury' })).toBeVisible();
  await expect(page.locator('.workspace-collection-link', { hasText: 'The Coastal Edit' })).toHaveCount(0);

  expect(api.savedPayloads).toHaveLength(1);
  const saved = api.savedPayloads[0];
  expect(saved.collections.map((collection) => collection.id)).toEqual(['quiet-luxury']);
  // Every post is still there, published, with its photo — only unlinked.
  expect(saved.edits.map((edit) => edit.id)).toEqual(['quiet-tailoring', 'coastal-notes', 'sunday-reset']);
  expect(saved.edits.find((edit) => edit.id === 'coastal-notes')).toMatchObject({ status: 'published', image: '/tastekin-media/coastal-notes.webp', collectionIds: [] });
  expect(saved.edits.find((edit) => edit.id === 'sunday-reset')).toMatchObject({ status: 'published', image: '/objects/uploads/11111111-1111-4111-8111-111111111111', collectionIds: ['quiet-luxury'] });
  expect(saved.edits.find((edit) => edit.id === 'quiet-tailoring')).toMatchObject({ status: 'published', collectionIds: ['quiet-luxury'] });
  // No media cleanup was requested for the posts or the collection's own upload.
  expect(api.cleanupRequests).toEqual([]);
  // Featured no longer lists it.
  expect(api.featuredPayloads.at(-1)).toEqual(['quiet-luxury']);
  expect(api.featured).toEqual(['quiet-luxury']);

  // The other demo collection is deletable the same way, from the manager list.
  await page.locator('.workspace-collection-link', { hasText: 'Quiet Luxury' }).click();
  await expect(page.getByRole('heading', { name: 'Quiet Luxury' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByTestId('collection-delete-button').click();
  await page.getByTestId('collection-delete-confirm-button').click();
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
  await expect(page.getByText('No Collections yet. Create one to start grouping your Edits.')).toBeVisible();
  expect(api.savedPayloads.at(-1)!.collections).toEqual([]);
  expect(api.savedPayloads.at(-1)!.edits.every((edit) => edit.collectionIds.length === 0 && edit.status === 'published' && Boolean(edit.image))).toBe(true);
  expect(api.cleanupRequests).toEqual([]);
  expect(api.featured).toEqual([]);
});

test('owner collection edit screen: a failed delete leaves the collection in place and closes the confirmation', async ({ page }) => {
  const api = new WorkspaceApi();
  await ownerPage(page, api);
  await openOwnCollection(page, 'Quiet Luxury');
  await page.getByTestId('collection-delete-button').click();
  api.workspace = { ...api.workspace, revision: api.workspace.revision + 3 }; // next save conflicts
  await page.getByTestId('collection-delete-confirm-button').click();
  await expect(page.getByTestId('collection-delete-confirm')).toHaveCount(0);
  await expect(page.getByTestId('collection-delete-button')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edit details' })).toBeVisible();
  expect(api.savedPayloads).toHaveLength(0);
  expect(api.featured).toEqual(['quiet-luxury', 'coastal-edit']);
});

test('Arabic: create and delete flows read correctly in RTL at 390px', async ({ page }) => {
  const api = new WorkspaceApi('ar');
  await page.context().addCookies([{ name: 'sid', value: ownerSession, url: 'http://127.0.0.1:23385' }]);
  await api.attach(page);
  await page.goto('/?lang=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByTestId('nav-you').click();
  await page.getByTestId('open-creator-workspace').click();
  await page.getByRole('button', { name: /أضف إلى مجموعة/ }).click();
  await expect(page.getByTestId('composer-create-collection')).toHaveText(/إنشاء مجموعة جديدة/);
  await page.getByTestId('composer-create-collection').click();
  await expect(page.getByTestId('composer-new-collection')).toContainText('مجموعة جديدة');
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('composer-new-collection').getByRole('button', { name: 'إلغاء' }).click();
  await expect(page.getByTestId('composer-new-collection')).toHaveCount(0);

  // The composer has no bottom nav; Back returns to the owner's profile hub.
  await page.getByRole('button', { name: 'رجوع' }).click();
  await page.getByRole('button', { name: 'عرض الملف' }).click();
  await page.getByRole('button', { name: 'المجموعات', exact: true }).click();
  await page.locator('button.approved-collection', { hasText: 'اختيارات الساحل' }).click();
  await page.getByRole('button', { name: 'تعديل التفاصيل' }).click();
  await expect(page.getByTestId('collection-delete-button')).toHaveText(/حذف المجموعة/);
  await page.getByTestId('collection-delete-button').click();
  await expect(page.getByTestId('collection-delete-confirm')).toContainText('تُحذف المجموعة فقط');
  await expectNoHorizontalOverflow(page);
  await shot(page, 'collection-delete-confirm-ar');
});
