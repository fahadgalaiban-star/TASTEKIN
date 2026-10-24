import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_CREATOR_PLACES_PER_PLAN,
  MAX_PRESELECTED_TRAVEL_INTERESTS,
  creatorPlacesForDestination,
  mergeCreatorPlacesIntoDays,
  placeMatchesDestination,
  travelInterestsForTaste,
} from '../../lib/taste-catalog/src/index.ts';

// --- chips from taste ---------------------------------------------------------

test('a café-and-lunch taste opens KIN Travel with Cafés and Dinner on, and nothing weaker', () => {
  const chips = travelInterestsForTaste({ categories: ['Restaurants'], tags: ['coffee-stops', 'long-lunches'] });
  assert.deepEqual([...chips].sort(), ['cafes', 'dinner'], 'breakfast has a single weak hint and stays off');
});

test('slow travel and architecture lean to culture and nature, strength training to gyms', () => {
  const chips = travelInterestsForTaste({ categories: ['Travel', 'Places'], tags: ['slow-travel', 'architecture'] });
  assert.ok(chips.includes('walking_places'), `walking places in ${chips}`);
  assert.ok(chips.includes('museums'), `museums in ${chips}`);
  const gym = travelInterestsForTaste({ categories: ['HealthFitness'], tags: ['strength-training', 'recovery'] });
  assert.equal(gym[0], 'gyms');
});

test('fashion and decor suggest shopping; an empty or unknown profile suggests nothing', () => {
  assert.equal(travelInterestsForTaste({ categories: ['Fashion', 'Decor'], tags: ['quiet-luxury', 'calm-interiors'] })[0], 'shopping');
  assert.deepEqual(travelInterestsForTaste(null), []);
  assert.deepEqual(travelInterestsForTaste({ categories: [], tags: [] }), []);
  assert.deepEqual(travelInterestsForTaste({ categories: ['NotACategory'], tags: ['not-a-tag'] }), []);
});

test('never more than the cap, stable for equal votes, and every value is a real chip', () => {
  const everything = travelInterestsForTaste({ categories: ['Restaurants', 'Travel', 'Places', 'Fashion', 'HealthFitness'], tags: ['coffee-stops', 'long-lunches', 'slow-travel', 'architecture', 'quiet-luxury', 'strength-training', 'hidden-gems'] });
  assert.equal(everything.length, MAX_PRESELECTED_TRAVEL_INTERESTS);
  const valid = new Set(['breakfast', 'dinner', 'cafes', 'shopping', 'museums', 'parks', 'hidden_gems', 'gyms', 'pilates', 'walking_places']);
  assert.ok(everything.every((chip) => valid.has(chip)));
  const a = travelInterestsForTaste({ categories: ['Restaurants'], tags: ['long-lunches', 'coffee-stops'] });
  const b = travelInterestsForTaste({ categories: ['Restaurants'], tags: ['coffee-stops', 'long-lunches'] });
  assert.deepEqual(a, b, 'tag order does not change the result');
});

// --- creator places in the destination --------------------------------------

const place = (editId, via, overrides = {}) => ({
  editId, via, creatorUsername: `creator-${editId}`, creatorDisplayName: `Creator ${editId}`,
  placeName: `Place ${editId.replace(/-/g, '')}`, locationLabel: 'Paris, France', location: '', locationAr: '', mapsUrl: null, updatedAt: new Date('2026-10-01T00:00:00Z'), ...overrides,
});

test('destination matching: city name against the Edit label, in English and Arabic, with qualifiers respected', () => {
  assert.equal(placeMatchesDestination({ placeName: 'Septime', locationLabel: 'Paris, France' }, 'Paris'), true);
  assert.equal(placeMatchesDestination({ placeName: 'Septime', locationLabel: 'Le Marais, Paris' }, 'paris'), true);
  assert.equal(placeMatchesDestination({ placeName: 'Septime', locationLabel: 'Paris, France' }, 'Paris, France'), true);
  assert.equal(placeMatchesDestination({ placeName: 'Septime', locationLabel: 'Paris, France' }, 'Paris, Texas'), false);
  assert.equal(placeMatchesDestination({ placeName: 'Septime', locationLabel: 'Lyon, France' }, 'Paris'), false);
  assert.equal(placeMatchesDestination({ placeName: 'مطعم', locationLabel: '', locationAr: 'دبي، الإمارات' }, 'دبي'), true);
  assert.equal(placeMatchesDestination({ placeName: 'Café', locationLabel: 'Kuwait City, Kuwait' }, 'Kuwait City'), true);
  assert.equal(placeMatchesDestination({ placeName: 'Café', locationLabel: '' }, 'Paris'), false);
  assert.equal(placeMatchesDestination({ placeName: 'Café', locationLabel: 'Paris' }, ''), false);
});

test('saved Edits come before followed creators, newest first inside each group, duplicates by place name dropped, capped', () => {
  const sources = [
    place('f-old', 'followed', { updatedAt: '2026-01-01T00:00:00Z' }),
    place('s-old', 'saved', { updatedAt: '2026-01-01T00:00:00Z' }),
    place('f-new', 'followed', { updatedAt: '2026-10-02T00:00:00Z' }),
    place('s-new', 'saved', { updatedAt: '2026-10-01T00:00:00Z' }),
    place('dup', 'followed', { placeName: 'PLACE snew!' }),
    place('elsewhere', 'saved', { locationLabel: 'Rome, Italy' }),
    place('f-3', 'followed'), place('f-4', 'followed'), place('f-5', 'followed'), place('f-6', 'followed'),
  ];
  const picked = creatorPlacesForDestination(sources, 'Paris');
  assert.deepEqual(picked.slice(0, 4).map((item) => item.editId), ['s-new', 's-old', 'f-new', 'f-3']);
  assert.ok(!picked.some((item) => item.editId === 'dup'), 'same place name only once');
  assert.ok(!picked.some((item) => item.editId === 'elsewhere'), 'another city is not a candidate');
  assert.equal(picked.length, MAX_CREATOR_PLACES_PER_PLAN);
  assert.ok(picked.every((item) => item.creatorUsername && item.placeName && item.via));
});

test('never by the numbers: follower, like and save counts are not inputs and cannot reorder creator places', () => {
  const plain = [place('a', 'followed', { updatedAt: '2026-05-01T00:00:00Z' }), place('b', 'followed', { updatedAt: '2026-06-01T00:00:00Z' })];
  const inflated = plain.map((source, index) => ({ ...source, followerCount: index === 0 ? 1_000_000 : 0, likeCount: index === 0 ? 1_000_000 : 0, saveCount: index === 0 ? 1_000_000 : 0 }));
  assert.deepEqual(creatorPlacesForDestination(inflated, 'Paris').map((item) => item.editId), creatorPlacesForDestination(plain, 'Paris').map((item) => item.editId));
  assert.equal(creatorPlacesForDestination(inflated, 'Paris')[0].editId, 'b', 'newest first, not most-followed first');
  for (const item of creatorPlacesForDestination(inflated, 'Paris')) {
    assert.ok(!('followerCount' in item) && !('likeCount' in item) && !('saveCount' in item), 'no count leaks into the output');
  }
});

// --- merging into the plan --------------------------------------------------

test('creator places join the emptiest day between breakfast and dinner, and a place already in the plan only gains the label', () => {
  const days = [
    [{ placeId: 'b1', requestedSlot: 'BREAKFAST' }, { placeId: 'm1', requestedSlot: null }, { placeId: 'd1', requestedSlot: 'DINNER' }],
    [{ placeId: 'b2', requestedSlot: 'BREAKFAST' }, { placeId: 'd2', requestedSlot: 'DINNER' }],
  ];
  const merged = mergeCreatorPlacesIntoDays(days, [
    { placeId: 'c1', requestedSlot: null, fromCreator: { username: 'x' } },
    { placeId: 'm1', requestedSlot: null, fromCreator: { username: 'y' } },
  ], (existing, incoming) => ({ ...existing, fromCreator: incoming.fromCreator }));
  assert.deepEqual(merged[1].map((p) => p.placeId), ['b2', 'c1', 'd2'], 'new place goes to the shorter day, before dinner');
  assert.deepEqual(merged[0].map((p) => p.placeId), ['b1', 'm1', 'd1'], 'nothing dropped or reordered on day 1');
  assert.equal(merged[0][1].fromCreator.username, 'y', 'existing stop labelled, not duplicated');
  assert.deepEqual(days[1].map((p) => p.placeId), ['b2', 'd2'], 'input untouched');
  assert.deepEqual(mergeCreatorPlacesIntoDays([], [{ placeId: 'c1', requestedSlot: null }], (e) => e), []);
});
