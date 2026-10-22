import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyExternalLink, isMapsUrl } from '../../artifacts/tastekin/src/lib/external-links.ts';

const SHELL = 'capacitor://localhost';
const API = 'https://cheerful-easygoing-bytes.replit.app';
const own = [SHELL, API];

test('ordinary web links open in the in-app browser', () => {
  assert.equal(classifyExternalLink('https://example.com/menu', own), 'in-app-browser');
  assert.equal(classifyExternalLink('http://restaurant.example/', own), 'in-app-browser');
  assert.equal(classifyExternalLink('https://www.booking-partner.example/offer?x=1', own), 'in-app-browser');
});

test('maps links keep the system behaviour so the Maps app opens', () => {
  for (const href of [
    'https://maps.apple.com/?ll=29.37,47.97&q=Cafe',
    'https://www.google.com/maps/search/?api=1&query=cafe',
    'https://google.com/maps/dir/?api=1&origin=a&destination=b',
    'https://maps.google.com/?q=cafe',
    'https://maps.app.goo.gl/abc123',
    'https://goo.gl/maps/abc123',
    'https://apple.com/maps?q=x',
  ]) {
    assert.equal(classifyExternalLink(href, own), 'system', href);
    assert.equal(isMapsUrl(new URL(href)), true, href);
  }
  // Not maps: a google.com page that is not /maps, and an unrelated host.
  assert.equal(classifyExternalLink('https://www.google.com/search?q=maps', own), 'in-app-browser');
  assert.equal(classifyExternalLink('https://notmaps.google.com.example/', own), 'in-app-browser');
});

test('non-web schemes are left to the system handler', () => {
  assert.equal(classifyExternalLink('mailto:support@example.com', own), 'system');
  assert.equal(classifyExternalLink('tel:+96500000000', own), 'system');
  assert.equal(classifyExternalLink('sms:+96500000000', own), 'system');
});

test('links to the app itself are untouched', () => {
  assert.equal(classifyExternalLink('/privacy', own), 'default');
  assert.equal(classifyExternalLink('#top', own), 'default');
  assert.equal(classifyExternalLink('', own), 'default');
  assert.equal(classifyExternalLink(`${SHELL}/support`, own), 'default');
  assert.equal(classifyExternalLink(`${API}/api/storage/objects/x`, own), 'default');
  assert.equal(classifyExternalLink(`${API}/posts/fheed/edit-1`, own), 'default');
});

test('malformed hrefs never throw and are left alone', () => {
  assert.equal(classifyExternalLink('http://[bad', own), 'default');
  assert.equal(classifyExternalLink('javascript:void(0)', own), 'system');
});

test('on the web (single origin) external links are still classified the same way', () => {
  const web = ['https://tastekin.app'];
  assert.equal(classifyExternalLink('https://tastekin.app/privacy', web), 'default');
  assert.equal(classifyExternalLink('https://example.com', web), 'in-app-browser');
});
