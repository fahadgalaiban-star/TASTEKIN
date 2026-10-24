import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editTasteTags, rankForYou, scoreEditForViewer } from '../../artifacts/api-server/src/lib/taste-ranking.ts';
import { calculateTasteMatch, tasteMatchFraction } from '../../artifacts/api-server/src/lib/taste-match.ts';

const viewer = { categories: ['Restaurants', 'Travel'], tags: ['coffee-stops', 'long-lunches', 'slow-travel'] };

test('scoreEditForViewer: category 35%, tags 65% (Jaccard), shared tastes listed', () => {
  const exact = scoreEditForViewer(viewer, { category: 'Restaurants', tasteTags: ['coffee-stops', 'long-lunches', 'slow-travel'] });
  assert.equal(exact.score, 100);
  const half = scoreEditForViewer(viewer, { category: 'Restaurants', tasteTags: ['coffee-stops'] });
  // 0.35 + 0.65 × (1 shared / 3 union) = 0.5667 → 57
  assert.equal(half.score, 57);
  assert.deepEqual(half.sharedTastes.map((taste) => taste.id), ['coffee-stops', 'Restaurants']);
  const none = scoreEditForViewer(viewer, { category: 'Decor', tasteTags: ['calm-interiors'] });
  assert.equal(none.score, 0);
  assert.deepEqual(none.sharedTastes, []);
});

test('scoreEditForViewer: no score without a complete viewer profile', () => {
  assert.equal(scoreEditForViewer(null, { category: 'Travel', tasteTags: ['slow-travel'] }).score, null);
  assert.equal(scoreEditForViewer({ categories: ['Travel'], tags: ['slow-travel'] }, { category: 'Travel', tasteTags: ['slow-travel'] }).score, null);
});

test('editTasteTags unions inferred words with the creator profile tags', () => {
  const tags = editTasteTags({ category: 'Travel', caption: 'A week in Lisbon by train.' }, ['coastal-escapes']);
  assert.ok(tags.includes('slow-travel'));
  assert.ok(tags.includes('coastal-escapes'));
});

test('Taste Match is no longer capped at 35% for a creator with no tags', () => {
  const creatorWithoutTags = { categories: ['Restaurants', 'Travel'], tasteTags: [] };
  assert.equal(calculateTasteMatch(viewer, creatorWithoutTags, true).score, 100);
  assert.equal(tasteMatchFraction(viewer, { categories: ['Restaurants'], tasteTags: [] }), 0.5);
  // With tags the weighted formula applies as before.
  assert.equal(calculateTasteMatch(viewer, { categories: ['Restaurants', 'Travel'], tasteTags: ['coffee-stops', 'long-lunches', 'slow-travel'] }, true).score, 100);
  assert.equal(calculateTasteMatch(viewer, { categories: ['Restaurants', 'Travel'], tasteTags: ['calm-interiors'] }, true).score, 35);
});

const day = (n) => new Date(Date.UTC(2026, 9, n));

test('rankForYou: score first, newest on ties, stable ids', () => {
  const items = [
    { id: 'old-high', creatorId: 'a', score: 90, updatedAt: day(1) },
    { id: 'new-low', creatorId: 'b', score: 10, updatedAt: day(20) },
    { id: 'new-high', creatorId: 'c', score: 90, updatedAt: day(15) },
    { id: 'unscored', creatorId: 'd', score: null, updatedAt: day(30) },
  ];
  assert.deepEqual(rankForYou(items).map((item) => item.id), ['new-high', 'old-high', 'new-low', 'unscored']);
});

test('rankForYou: the same creator never appears twice in a row when another is available', () => {
  const items = [
    { id: 'a1', creatorId: 'a', score: 90, updatedAt: day(9) },
    { id: 'a2', creatorId: 'a', score: 88, updatedAt: day(8) },
    { id: 'a3', creatorId: 'a', score: 86, updatedAt: day(7) },
    { id: 'b1', creatorId: 'b', score: 50, updatedAt: day(6) },
    { id: 'c1', creatorId: 'c', score: 40, updatedAt: day(5) },
  ];
  const order = rankForYou(items).map((item) => item.id);
  assert.deepEqual(order, ['a1', 'b1', 'a2', 'c1', 'a3']);
  assert.equal(order.length, items.length, 'nothing is dropped');
});

test('rankForYou: when only one creator remains, its Edits follow each other (nothing is hidden)', () => {
  const items = [
    { id: 'a1', creatorId: 'a', score: 90, updatedAt: day(9) },
    { id: 'a2', creatorId: 'a', score: 80, updatedAt: day(8) },
  ];
  assert.deepEqual(rankForYou(items).map((item) => item.id), ['a1', 'a2']);
});

test('never by the numbers: likes, saves, views and follower counts cannot move the order', () => {
  const base = [
    { id: 'x', creatorId: 'a', score: 70, updatedAt: day(3) },
    { id: 'y', creatorId: 'b', score: 60, updatedAt: day(4) },
    { id: 'z', creatorId: 'c', score: 60, updatedAt: day(2) },
    { id: 'w', creatorId: 'd', score: 10, updatedAt: day(9) },
  ];
  const expected = rankForYou(base).map((item) => item.id);
  let seed = 7;
  const random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  for (let round = 0; round < 50; round += 1) {
    const decorated = base.map((item) => ({
      ...item,
      likeCount: Math.floor(random() * 1e6),
      saveCount: Math.floor(random() * 1e6),
      viewCount: Math.floor(random() * 1e9),
      followerCount: Math.floor(random() * 1e7),
      popularity: random(),
    }));
    assert.deepEqual(rankForYou(decorated).map((item) => item.id), expected);
  }
});

test('never by the numbers: the scorer has no count input either', () => {
  const withCounts = scoreEditForViewer(viewer, { category: 'Restaurants', tasteTags: ['coffee-stops'], likeCount: 999999, followerCount: 5e6 });
  const without = scoreEditForViewer(viewer, { category: 'Restaurants', tasteTags: ['coffee-stops'] });
  assert.equal(withCounts.score, without.score);
});
