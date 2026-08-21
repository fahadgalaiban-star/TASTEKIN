import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import path from 'node:path';

type Access = 'public' | 'locked';
type Edit = {
  id: string;
  category: string;
  title: string;
  titleAr: string;
  caption: string;
  captionAr: string;
  image: string;
  sourceImage?: string;
  previewImage?: string;
  imageMetadata?: { name: string; size: number; contentType: string };
  crop?: { aspect: string; zoom: number; x: number; y: number; rotation: number; sourceWidth: number; sourceHeight: number; outputWidth: number; outputHeight: number };
  location: string;
  locationAr: string;
  altText: string;
  access: Access;
  status: 'draft' | 'published' | 'archived';
  collectionIds: string[];
};

type Workspace = {
  creatorId: string;
  revision: number;
  updatedAt: string;
  edits: Edit[];
  collections: unknown[];
};

const ownerSession = 'tastekin-e2e-owner';
const imagePath = path.resolve(import.meta.dirname, '../public/tastekin-media/private-hotel-preview.webp');
const onePixelImage = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==',
  'base64',
);

const existingEdit: Edit = {
  id: 'existing-public-edit',
  category: 'Fashion',
  title: 'Existing public edit',
  titleAr: '',
  caption: 'A published edit used to open the creator workspace.',
  captionAr: '',
  image: '/tastekin-media/quiet-tailoring.webp',
  location: 'Kuwait City, Kuwait',
  locationAr: 'مدينة الكويت، الكويت',
  altText: 'A published edit.',
  access: 'public',
  status: 'published',
  collectionIds: [],
};

class PrivateCropApi {
  workspace: Workspace = {
    creatorId: 'fheed',
    revision: 1,
    updatedAt: new Date().toISOString(),
    edits: [existingEdit],
    collections: [],
  };

  readonly objectPaths: string[] = [];
  readonly uploadedPaths = new Set<string>();
  readonly cleanedPaths = new Set<string>();
  readonly cleanupRequests: string[][] = [];
  private uploadNumber = 0;
  private saveMode: 'succeeds' | 'conflicts' | 'waits' = 'succeeds';
  private releaseSave: (() => void) | undefined;
  private saveRelease = Promise.resolve();

  deferNextSave() {
    this.saveMode = 'waits';
    this.saveRelease = new Promise<void>((resolve) => {
      this.releaseSave = resolve;
    });
  }

  conflictNextSave() {
    this.saveMode = 'conflicts';
  }

  finishDeferredSave() {
    this.releaseSave?.();
  }

  async attach(page: Page) {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.hostname === 'uploads.tastekin.test') {
        if (request.method() === 'PUT') {
          this.uploadedPaths.add(url.pathname.replace('/upload/', ''));
          await route.fulfill({ status: 204 });
          return;
        }
        await route.fulfill({ status: 405 });
        return;
      }

      if (!url.pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }

      await this.handleApiRoute(route);
    });
  }

  private isOwner(route: Route) {
    return route.request().headers().cookie?.includes(`sid=${ownerSession}`) ?? false;
  }

  private requestBody(route: Route): Record<string, unknown> {
    const body = route.request().postData();
    return body ? JSON.parse(body) as Record<string, unknown> : {};
  }

  private publicWorkspace(): Workspace {
    return {
      ...this.workspace,
      edits: this.workspace.edits
        .filter((edit) => edit.status === 'published')
        .map((edit) => {
          if (edit.access === 'locked') {
            return {
              ...edit,
              image: `/api/public-media/${edit.id}/preview`,
              previewImage: `/api/public-media/${edit.id}/preview`,
              sourceImage: undefined,
            };
          }
          return edit.image.startsWith('/objects/')
            ? { ...edit, image: `/api/public-media/${edit.id}` }
            : edit;
        }),
    };
  }

  private async image(route: Route, status = 200) {
    await route.fulfill({
      status,
      contentType: 'image/png',
      body: status === 200 ? onePixelImage : JSON.stringify({ error: 'Media object not found' }),
    });
  }

  private async handleApiRoute(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const owner = this.isOwner(route);

    if (url.pathname === '/api/creator-workspace') {
      if (request.method() === 'GET') {
        await route.fulfill({ json: owner ? this.workspace : this.publicWorkspace() });
        return;
      }
      if (request.method() === 'PUT') {
        if (!owner) {
          await route.fulfill({ status: 401, json: { error: 'Sign in to update the creator workspace' } });
          return;
        }
        if (this.saveMode === 'conflicts') {
          await route.fulfill({ status: 409, json: { error: 'Creator workspace changed on another device. Reload before saving.' } });
          return;
        }
        if (this.saveMode === 'waits') {
          await this.saveRelease;
          this.saveMode = 'succeeds';
        }
        const payload = this.requestBody(route);
        this.workspace = {
          ...this.workspace,
          edits: payload.edits as Edit[],
          collections: payload.collections as unknown[],
          revision: this.workspace.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        await route.fulfill({ json: this.workspace });
        return;
      }
    }

    if (url.pathname === '/api/storage/uploads/request-url') {
      if (!owner) {
        await route.fulfill({ status: 401, json: { error: 'Sign in to upload media' } });
        return;
      }
      const metadata = this.requestBody(route);
      const objectPath = `/objects/uploads/private-crop-${++this.uploadNumber}`;
      this.objectPaths.push(objectPath);
      await route.fulfill({
        json: {
          uploadURL: `https://uploads.tastekin.test/upload/${objectPath}`,
          objectPath,
          metadata,
        },
      });
      return;
    }

    if (url.pathname === '/api/storage/uploads/cleanup') {
      if (!owner) {
        await route.fulfill({ status: 403, json: { error: 'Only the creator can clean up media' } });
        return;
      }
      const objectPaths = this.requestBody(route).objectPaths as string[];
      this.cleanupRequests.push(objectPaths);
      objectPaths.forEach((objectPath) => this.cleanedPaths.add(objectPath));
      await route.fulfill({ status: 204 });
      return;
    }

    if (url.pathname.startsWith('/api/storage/objects/')) {
      const objectPath = url.pathname.replace('/api/storage', '');
      await this.image(route, owner && this.objectPaths.includes(objectPath) && !this.cleanedPaths.has(objectPath) ? 200 : 404);
      return;
    }

    const previewMatch = url.pathname.match(/^\/api\/public-media\/([^/]+)\/preview$/);
    if (previewMatch) {
      const edit = this.workspace.edits.find((item) => item.id === previewMatch[1]);
      await this.image(route, edit?.access === 'locked' && Boolean(edit.previewImage) ? 200 : 404);
      return;
    }

    const publicMatch = url.pathname.match(/^\/api\/public-media\/([^/]+)$/);
    if (publicMatch) {
      const edit = this.workspace.edits.find((item) => item.id === publicMatch[1]);
      await this.image(route, edit?.access === 'public' && edit.status === 'published' ? 200 : 404);
      return;
    }

    await route.fulfill({ status: 404, json: { error: 'Not found' } });
  }
}

async function creatorPage(browser: Browser, api: PrivateCropApi) {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'sid', value: ownerSession, url: 'http://127.0.0.1:23385' }]);
  const page = await context.newPage();
  await api.attach(page);
  await page.goto('/');
  await page.getByTestId('nav-add').click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed.' })).toBeVisible();
  return { context, page };
}

type CropFormat = { button: string; aspect: string; width: number; height: number };

const cropFormats: CropFormat[] = [
  { button: 'Post Portrait', aspect: 'portrait', width: 1080, height: 1350 },
  { button: 'Post Square', aspect: 'square', width: 1080, height: 1080 },
  { button: 'Story / Reel', aspect: 'story', width: 1080, height: 1920 },
];

async function prepareCrop(page: Page, format: CropFormat = cropFormats[0]) {
  await page.getByRole('button', { name: 'New Edit' }).click();
  await page.locator('input[type="file"]').setInputFiles(imagePath);
  await expect(page.locator('[aria-label="Crop image"]')).toBeVisible();
  await page.getByRole('button', { name: format.button }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Create an Edit' })).toBeVisible();
}

async function fillRequiredFields(page: Page, title: string) {
  await page.getByLabel('Caption (optional)', { exact: true }).fill(title);
}

async function publish(page: Page, title: string, access: Access) {
  await fillRequiredFields(page, title);
  if (access === 'locked') {
    await page.getByRole('button', { name: 'Subscribers Only' }).click();
  }
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed.' })).toBeVisible();
}

test('an authenticated creator persists each exact canonical crop format after publishing and refreshing', async ({ browser }) => {
  const api = new PrivateCropApi();
  const { context, page } = await creatorPage(browser, api);

  for (const format of cropFormats) {
    const title = `${format.aspect} crop survives refresh`;
    await prepareCrop(page, format);
    await publish(page, title, 'public');
    expect(api.workspace.edits.find((edit) => edit.title === title)).toMatchObject({
      access: 'public',
      status: 'published',
      crop: { aspect: format.aspect, outputWidth: format.width, outputHeight: format.height },
    });
  }

  expect(api.objectPaths).toHaveLength(9);
  expect(api.objectPaths.every((path) => api.uploadedPaths.has(path))).toBe(true);
  expect(api.cleanedPaths).toEqual(new Set());
  expect(api.workspace.edits.find((edit) => edit.title === 'portrait crop survives refresh')).toMatchObject({ sourceImage: api.objectPaths[0], image: api.objectPaths[1], previewImage: api.objectPaths[2] });

  await page.reload();
  await page.getByTestId('nav-add').click();
  await expect(page.getByText('portrait crop survives refresh')).toBeVisible();
  await expect(page.getByText('square crop survives refresh')).toBeVisible();
  await expect(page.getByText('story crop survives refresh')).toBeVisible();
  expect(api.cleanupRequests).toEqual([]);
  await context.close();
});

test('anonymous visitors receive only a locked crop preview and cannot retrieve its source or crop', async ({ browser }) => {
  const api = new PrivateCropApi();
  const owner = await creatorPage(browser, api);

  await prepareCrop(owner.page);
  await publish(owner.page, 'Locked crop stays private', 'locked');
  const locked = api.workspace.edits.find((edit) => edit.title === 'Locked crop stays private');
  expect(locked).toBeDefined();
  expect(api.objectPaths.every((path) => api.uploadedPaths.has(path))).toBe(true);

  await owner.page.reload();
  await owner.page.getByTestId('nav-add').click();
  await expect(owner.page.getByText('Locked crop stays private')).toBeVisible();

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await api.attach(visitor);
  await visitor.goto('/');
  await expect(visitor.getByRole('button', { name: 'Locked crop stays private' })).toBeVisible();
  const card = visitor.locator('article').filter({ hasText: 'Locked crop stays private' });
  await expect(card.locator('img')).toHaveAttribute('src', `/api/public-media/${locked!.id}/preview`);

  const [preview, source, crop] = await visitor.evaluate(async ({ id, sourceImage, image }) => Promise.all([
    fetch(`/api/public-media/${id}/preview`).then((response) => response.status),
    fetch(`/api/storage${sourceImage}`).then((response) => response.status),
    fetch(`/api/storage${image}`).then((response) => response.status),
  ]), { id: locked!.id, sourceImage: locked!.sourceImage, image: locked!.image });
  expect(preview).toBe(200);
  expect(source).toBe(404);
  expect(crop).toBe(404);

  await visitorContext.close();
  await owner.context.close();
});

test('cancelling after a crop leaves no remote private renditions to clean up', async ({ browser }) => {
  const api = new PrivateCropApi();
  const { context, page } = await creatorPage(browser, api);

  await prepareCrop(page);
  await page.getByLabel('Close editor').click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed.' })).toBeVisible();
  expect(api.objectPaths).toEqual([]);
  expect(api.cleanupRequests).toEqual([]);
  await context.close();
});

test('a save conflict cleans up a cropped image instead of abandoning private objects', async ({ browser }) => {
  const api = new PrivateCropApi();
  const { context, page } = await creatorPage(browser, api);

  await prepareCrop(page);
  await fillRequiredFields(page, 'Conflict removes private media');
  api.conflictNextSave();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('another device');
  await expect.poll(() => api.cleanupRequests.length).toBe(1);
  expect(api.cleanupRequests[0]).toEqual(api.objectPaths);
  expect(api.objectPaths.every((path) => api.cleanedPaths.has(path))).toBe(true);
  await context.close();
});

test('page exit cleans abandoned crops but never deletes media while a publish is in flight', async ({ browser }) => {
  const exitApi = new PrivateCropApi();
  const exiting = await creatorPage(browser, exitApi);
  await prepareCrop(exiting.page);
  await exiting.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(exitApi.objectPaths).toEqual([]);
  expect(exitApi.cleanupRequests).toEqual([]);
  await exiting.context.close();

  const saveApi = new PrivateCropApi();
  const saving = await creatorPage(browser, saveApi);
  await prepareCrop(saving.page);
  await fillRequiredFields(saving.page, 'In-flight publish keeps media');
  saveApi.deferNextSave();
  await saving.page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(saving.page.getByText('Saving your creator changes across devices…')).toBeVisible();
  await saving.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(saving.page.getByRole('heading', { name: 'Create an Edit' })).toBeVisible();
  expect(saveApi.cleanupRequests).toEqual([]);

  saveApi.finishDeferredSave();
  await expect(saving.page.getByRole('heading', { name: 'Good afternoon, Fheed.' })).toBeVisible();
  expect(saveApi.objectPaths.every((path) => saveApi.cleanedPaths.has(path))).toBe(false);
  await saving.context.close();
});