import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { prepareStaticPublic } from '../../artifacts/tastekin/static-public.ts';
import { packagedMediaLinks, packagedMediaReference, trustedMediaOrigins } from '../../artifacts/api-server/src/lib/packaged-media.ts';
import { packagedMediaUrl } from '../../artifacts/tastekin/src/lib/packaged-media-url.ts';

test('static public staging excludes all content media and retains unrelated UI assets without changing sources', async () => {
  const root = await mkdtemp('/tmp/tastekin-static-test.');
  try {
    const source = path.join(root, 'source'), destination = path.join(root, 'static');
    await mkdir(path.join(source, 'tastekin-media'), { recursive: true });
    await writeFile(path.join(source, 'tastekin-media/photo.webp'), 'original bytes');
    await writeFile(path.join(source, 'favicon.svg'), '<svg/>');
    await prepareStaticPublic(source, destination);
    assert.deepEqual(await readdir(destination), ['favicon.svg']);
    assert.equal(await readFile(path.join(source, 'tastekin-media/photo.webp'), 'utf8'), 'original bytes');
    assert.equal(await readFile(path.join(destination, 'favicon.svg'), 'utf8'), '<svg/>');
    await mkdir(path.join(destination, 'tastekin-media'));
    await prepareStaticPublic(source, destination);
    assert.deepEqual(await readdir(destination), ['favicon.svg'], 'stale static copies must be removed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('comment candidates handle encoded extensions/prose and configured origins across app aliases', () => {
  const original = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'https://app.example.invalid,https://alias.example.invalid';
  try {
    const origins = trustedMediaOrigins('http://127.0.0.1:8080');
    assert.deepEqual(packagedMediaLinks('See /tastekin-media/quiet-tailoring%2Ewebp. And [/tastekin-media/photo.webp].', origins),
      ['/tastekin-media/quiet-tailoring.webp', '/tastekin-media/photo.webp']);
    assert.deepEqual(packagedMediaLinks('https://app.example.invalid/tastekin-media/photo.webp?x=1 https://external.invalid/tastekin-media/photo.webp', origins),
      ['/tastekin-media/photo.webp']);
    assert.equal(packagedMediaReference('https://app.example.invalid/tastekin-media/photo.webp', trustedMediaOrigins('https://alias.example.invalid')),
      '/tastekin-media/photo.webp');
  } finally {
    if (original === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = original;
  }
});
test('direct media identity decodes known URLs, drops query cache busters, rejects traversal and remote lookalikes', () => {
  assert.equal(packagedMediaReference('/tastekin-media/quiet%2Dtailoring.webp?x=1'), '/tastekin-media/quiet-tailoring.webp');
  assert.equal(packagedMediaReference('/TaStEkIn-MeDiA/photo.webp'), '/tastekin-media/photo.webp');
  assert.equal(packagedMediaReference('https://external.invalid/tastekin-media/photo.webp'), undefined);
  assert.equal(packagedMediaReference('https://own.invalid/tastekin-media/photo.webp?x=1', new Set(['https://own.invalid'])), '/tastekin-media/photo.webp');
  for (const input of ['/tastekin-media/%2e%2e%2fsecret.webp', '/tastekin-media/%ZZ.webp',
    '/tastekin-media/%252e%252e.webp', '/tastekin-media/.hidden.webp', '/api/admin/reports/photo.webp'])
    assert.equal(packagedMediaReference(input), undefined, input);
});
test('native public packaged images use the existing API origin without changing private/local/external/web URLs', () => {
  assert.equal(packagedMediaUrl('/tastekin-media/photo.webp', true, 'https://api.example.invalid/'),
    'https://api.example.invalid/tastekin-media/photo.webp');
  assert.equal(packagedMediaUrl('/tastekin-media/photo.webp', false, 'https://api.example.invalid'), '/tastekin-media/photo.webp');
  for (const source of [undefined, null, 'blob:local', 'data:image/png;base64,AA==', '/api/storage/objects/uploads/private',
    '/favicon.svg', 'https://external.invalid/tastekin-media/photo.webp'])
    assert.equal(packagedMediaUrl(source, true, 'https://api.example.invalid'), source);
});