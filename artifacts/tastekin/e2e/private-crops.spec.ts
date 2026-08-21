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
  image?: string;
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
type CreatorProfile = {
  displayName: string;
  username: string;
  bio: string;
  city: string;
  country: string;
  interests: string[];
  avatar: string;
  avatarObjectPath: string | null;
  age: number | null;
  dateOfBirth: string | null;
  showAge: boolean;
  verified: boolean;
  revision: number;
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
  profile: CreatorProfile = {
    displayName: 'Fheed Alaiban',
    username: 'fheed',
    bio: 'A considered edit of fashion, places, travel, and the rituals that make everyday life feel better.',
    city: 'Kuwait City',
    country: 'Kuwait',
    interests: ['Fashion', 'Travel', 'Places'],
    avatar: '/tastekin-media/fheed-profile.webp',
    avatarObjectPath: null,
    age: null,
    dateOfBirth: null,
    showAge: false,
    verified: true,
    revision: 1,
  };
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
          if (edit.access === 'locked' && edit.image) {
            return {
              ...edit,
              image: `/api/public-media/${edit.id}/preview`,
              previewImage: `/api/public-media/${edit.id}/preview`,
              sourceImage: undefined,
            };
          }
          return edit.image?.startsWith('/objects/')
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

    if (url.pathname === '/api/creator-profile') {
      if (request.method() === 'GET') {
        await route.fulfill({ json: owner ? { ...this.profile, revision: this.workspace.revision } : { ...this.profile, dateOfBirth: null, avatarObjectPath: null, revision: this.workspace.revision } });
        return;
      }
      if (request.method() === 'PUT') {
        if (!owner) {
          await route.fulfill({ status: 403, json: { error: 'Only the verified Fheed creator can update this profile' } });
          return;
        }
        const payload = this.requestBody(route) as Omit<CreatorProfile, 'avatar' | 'age' | 'verified'>;
        const avatarObjectPath = payload.avatarObjectPath ?? this.profile.avatarObjectPath;
        this.workspace = { ...this.workspace, revision: this.workspace.revision + 1, updatedAt: new Date().toISOString() };
        this.profile = {
          ...this.profile,
          ...payload,
          avatarObjectPath,
          avatar: avatarObjectPath ? '/api/public-profile-media' : this.profile.avatar,
          age: payload.showAge && payload.dateOfBirth ? 30 : null,
          revision: this.workspace.revision,
        };
        await route.fulfill({ json: this.profile });
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

    if (url.pathname === '/api/public-profile-media') {
      await this.image(route, this.profile.avatarObjectPath && !this.cleanedPaths.has(this.profile.avatarObjectPath) ? 200 : 404);
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

test('creator profile photo, private birthday, and public age settings persist without exposing counts', async ({ browser }) => {
  const api = new PrivateCropApi();
  const { context, page } = await creatorPage(browser, api);

  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await page.getByLabel('Display name').fill('Fheed Alaiban Studio');
  await page.getByLabel('Username').fill('fheedstudio');
  await page.getByLabel('Bio').fill('A private profile edit that survives refresh.');
  await page.getByLabel('City').fill('London');
  await page.getByLabel('Country').fill('United Kingdom');
  await page.getByRole('textbox', { name: 'Date of birth' }).fill('1996-04-15');
  await page.getByRole('checkbox', { name: 'Show my age on my profile' }).check();
  await page.getByLabel('Change profile photo').setInputFiles(imagePath);
  await expect(page.getByLabel('Crop profile photo')).toBeVisible();
  await page.getByRole('button', { name: 'Use photo' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect(page.getByRole('status')).toContainText('Profile saved');
  expect(api.profile).toMatchObject({
    displayName: 'Fheed Alaiban Studio',
    username: 'fheedstudio',
    city: 'London',
    country: 'United Kingdom',
    dateOfBirth: '1996-04-15',
    showAge: true,
  });
  expect(api.profile.avatarObjectPath).toBeTruthy();

  await page.getByTestId('nav-add').click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect.poll(() => api.workspace.edits[0]?.status).toBe('archived');

  await page.reload();
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByRole('heading', { name: 'Fheed Alaiban Studio' })).toBeVisible();
  await expect(page.getByText(/Age 30/)).toBeVisible();
  await expect(page.locator('.taste-seal img')).toHaveJSProperty('complete', true);
  expect(await page.locator('.taste-seal img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Verified by TASTEKIN' }).click();
  await expect(page.getByRole('dialog')).toContainText('Verified by TASTEKIN — selected for authentic taste and identity.');

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByTestId('identity-consumer').click();
  await page.getByTestId('nav-explore').click();
  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.getByRole('button', { name: 'Follow' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Subscribe · \$19\.99/ })).toBeVisible();
  await expect(page.getByText(/followers/i)).toHaveCount(0);
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

test('a no-photo restaurant recommendation validates, persists, and displays without media', async ({ browser }) => {
  const api = new PrivateCropApi();
  api.workspace.edits.push({
    ...existingEdit,
    id: 'draft-book-category',
    category: 'Books',
    title: 'Draft reading list',
    caption: 'A draft that must not create a public profile category.',
    status: 'draft',
  });
  const { context, page } = await creatorPage(browser, api);

  await page.getByRole('button', { name: 'New Edit' }).click();
  await page.getByText('Add details', { exact: true }).click();
  await page.getByLabel('Category').selectOption('Restaurants');
  await expect(page.getByTestId('place-edit-fields')).toBeVisible();
  await expect(page.getByLabel('Location', { exact: true })).toHaveCount(0);
  await page.getByLabel('Place name').fill('Alba Table');
  await page.getByLabel('Readable location').fill('Kuwait City, Kuwait');
  await page.getByLabel('Your review (optional)').fill('A quiet lunch I would return to for the bread and the light.');
  await page.getByRole('button', { name: '4 out of 5' }).click();
  await page.getByLabel('Google Maps or Apple Maps link (optional)').fill('https://maps.apple.com/?q=Alba+Table');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good afternoon, Fheed.' })).toBeVisible();

  const saved = api.workspace.edits.find((edit) => edit.placeName === 'Alba Table');
  expect(saved).toMatchObject({ category: 'Restaurants', locationLabel: 'Kuwait City, Kuwait', tasteRating: 4 });
  expect(saved).not.toHaveProperty('image');

  await page.getByTestId('nav-home').click();
  const homeCard = page.getByTestId(`edit-card-${saved!.id}`);
  await expect(homeCard).toBeVisible();
  await expect(homeCard.locator('img')).toHaveCount(0);
  await expect(homeCard.getByTestId(`taste-rating-${saved!.id}`)).toBeVisible();
  await expect(homeCard.getByText('Fheed’s Taste Rating · 4/5')).toBeVisible();
  await expect(homeCard.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', 'https://maps.apple.com/?q=Alba+Table');

  await homeCard.locator('.place-card-main').click();
  await expect(page.getByRole('heading', { name: 'Alba Table' })).toHaveCount(1);
  await expect(page.getByText('A quiet lunch I would return to for the bread and the light.')).toBeVisible();
  await expect(page.locator('.approved-detail-art')).toHaveCount(0);
  await expect(page.locator('.place-detail-panel')).toBeVisible();

  await page.getByTestId('nav-explore').click();
  await expect(page.getByTestId(`edit-card-${saved!.id}`)).toBeVisible();
  await page.getByTestId('fheed-profile-mini').click();
  await expect(page.getByTestId('profile-category-All')).toBeVisible();
  await expect(page.getByTestId('profile-category-Fashion')).toBeVisible();
  await expect(page.getByTestId('profile-category-Restaurants')).toBeVisible();
  await expect(page.getByTestId('profile-category-Books')).toHaveCount(0);
  const profilePlaceCard = page.locator('.place-grid-card');
  await expect(profilePlaceCard).toContainText('Alba Table');
  await expect(profilePlaceCard).toContainText('Kuwait City, Kuwait');
  await expect(profilePlaceCard).toContainText('A quiet lunch I would return to for the bread and the light.');
  await expect(profilePlaceCard.locator('img')).toHaveCount(0);
  const profileGrid = page.getByTestId('profile-edits-grid');
  const cardDimensions = await profileGrid.locator('.approved-grid-card').evaluateAll((cards) => cards.slice(0, 2).map((card) => {
    const { width, height } = card.getBoundingClientRect();
    return { width, height };
  }));
  expect(cardDimensions).toHaveLength(2);
  for (const card of cardDimensions) {
    expect(card.height / card.width).toBeCloseTo(1.25, 1);
  }
  expect(cardDimensions[0].height).toBeCloseTo(cardDimensions[1].height, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);

  await page.reload();
  await page.getByTestId('nav-you').click();
  await page.getByRole('button', { name: 'View profile' }).click();
  await expect(page.getByTestId('profile-category-Restaurants')).toBeVisible();
  await expect(page.getByTestId('profile-category-Books')).toHaveCount(0);
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId(`edit-card-${saved!.id}`)).toBeVisible();
  await context.close();
});

test('a no-photo place edit blocks missing requirements and invalid map links', async ({ browser }) => {
  const api = new PrivateCropApi();
  const { context, page } = await creatorPage(browser, api);

  await page.getByRole('button', { name: 'New Edit' }).click();
  await page.getByText('Add details', { exact: true }).click();
  await page.getByLabel('Category').selectOption('Places');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Add the place name');

  await page.getByLabel('Place name').fill('A small gallery');
  await page.getByLabel('Readable location').fill('Sharq, Kuwait');
  await page.getByLabel('Your review (optional)').fill('A considered stop on a bright afternoon.');
  await page.getByLabel('Google Maps or Apple Maps link (optional)').fill('https://example.com/not-maps');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('valid Google Maps or Apple Maps link');
  await page.getByLabel('Google Maps or Apple Maps link (optional)').fill('https://maps.apple.com/?q=A+small+gallery');
  await page.getByRole('button', { name: 'Subscribers Only', exact: true }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('must be public');
  expect(api.objectPaths).toEqual([]);
  await context.close();
});

test('a photo-based place edit retains the crop upload flow and renders its map details', async ({ browser }) => {
  const api = new PrivateCropApi();
  const { context, page } = await creatorPage(browser, api);

  await prepareCrop(page);
  await page.getByText('Add details', { exact: true }).click();
  await page.getByLabel('Category').selectOption('Travel');
  await page.getByLabel('Place name').fill('Harbor House');
  await page.getByLabel('Readable location').fill('The Aegean Coast');
  await page.getByRole('button', { name: '5 out of 5' }).click();
  await page.getByLabel('Google Maps or Apple Maps link (optional)').fill('https://www.google.com/maps/search/?api=1&query=Harbor+House');
  await publish(page, 'A photo-backed place recommendation', 'public');

  const saved = api.workspace.edits.find((edit) => edit.placeName === 'Harbor House');
  expect(saved?.image).toMatch(/^\/objects\/uploads\//);
  expect(saved?.crop).toMatchObject({ aspect: 'portrait', outputWidth: 1080, outputHeight: 1350 });
  expect(api.objectPaths).toHaveLength(3);

  await page.getByTestId('nav-home').click();
  const card = page.getByTestId(`edit-card-${saved!.id}`);
  await expect(card.locator('img')).toHaveCount(1);
  await expect(card.getByText('Harbor House')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Harbor+House');
  await context.close();
});