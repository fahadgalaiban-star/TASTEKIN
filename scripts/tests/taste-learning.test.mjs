import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TASTE_LEARNING, decayFactor, implicitTaste } from '../../artifacts/api-server/src/lib/taste-learning.ts';
import { TASTE_LEARNING_BLEND, scoreEditForViewer, scoreEditWithLearning } from '../../artifacts/api-server/src/lib/taste-ranking.ts';

const now = new Date('2026-10-24T12:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000);

const edits = new Map([
  ['cafe-1', { editId: 'cafe-1', creatorId: 'cafe', category: 'Restaurants', tasteTags: ['coffee-stops', 'long-lunches'] }],
  ['cafe-2', { editId: 'cafe-2', creatorId: 'cafe', category: 'Restaurants', tasteTags: ['coffee-stops'] }],
  ['cafe-3', { editId: 'cafe-3', creatorId: 'cafe', category: 'Restaurants', tasteTags: ['table-setting'] }],
  ['cafe-4', { editId: 'cafe-4', creatorId: 'cafe', category: 'Restaurants', tasteTags: ['table-setting'] }],
  ['gym-1', { editId: 'gym-1', creatorId: 'gym', category: 'HealthFitness', tasteTags: ['strength-training'] }],
  ['decor-1', { editId: 'decor-1', creatorId: 'decor', category: 'Decor', tasteTags: ['calm-interiors', 'natural-light'] }],
]);
const creators = new Map([
  ['cafe', { creatorId: 'cafe', categories: ['Restaurants'], tasteTags: ['coffee-stops', 'long-lunches', 'table-setting'] }],
  ['gym', { creatorId: 'gym', categories: ['HealthFitness'], tasteTags: ['strength-training', 'recovery'] }],
  ['decor', { creatorId: 'decor', categories: ['Decor'], tasteTags: ['calm-interiors', 'natural-light'] }],
]);

test('decay: full weight now, half after one half-life, a quarter after two', () => {
  assert.equal(decayFactor(now, now), 1);
  assert.ok(Math.abs(decayFactor(daysAgo(30), now) - 0.5) < 1e-9);
  assert.ok(Math.abs(decayFactor(daysAgo(60), now) - 0.25) < 1e-9);
});

test('weights: save > like > view, follow and circle spread over the creator tags', () => {
  const learned = implicitTaste([
    { kind: 'save', editId: 'cafe-1', at: now },
    { kind: 'like', editId: 'gym-1', at: now },
    { kind: 'view', editId: 'decor-1', at: now },
  ], edits, creators, now);
  assert.equal(learned.tags['coffee-stops'], TASTE_LEARNING.weights.save);
  assert.equal(learned.tags['strength-training'], TASTE_LEARNING.weights.like);
  assert.equal(learned.tags['calm-interiors'], TASTE_LEARNING.weights.view);
  const followed = implicitTaste([{ kind: 'follow', creatorId: 'gym', at: now }], edits, creators, now);
  assert.ok(Math.abs(followed.tags['strength-training'] - TASTE_LEARNING.weights.follow / 2) < 1e-9, 'split across two creator tags');
  assert.equal(followed.categories['HealthFitness'], TASTE_LEARNING.weights.follow);
});

test('views are capped per creator so a binge cannot dominate', () => {
  const learned = implicitTaste([
    { kind: 'view', editId: 'cafe-3', at: now },
    { kind: 'view', editId: 'cafe-4', at: now },
    { kind: 'view', editId: 'cafe-3', at: daysAgo(1) },
    { kind: 'view', editId: 'cafe-4', at: daysAgo(1) },
    { kind: 'view', editId: 'cafe-3', at: daysAgo(2) },
  ], edits, creators, now);
  // Only the 3 newest views count: 0.5 + 0.5 + 0.5×decay(1 day).
  assert.ok(learned.tags['table-setting'] < TASTE_LEARNING.weights.view * 3 + 1e-9);
  assert.ok(learned.tags['table-setting'] > TASTE_LEARNING.weights.view * 2.9);
});

test('dwell scales with seconds up to the full-weight threshold', () => {
  const short = implicitTaste([{ kind: 'dwell', editId: 'gym-1', at: now, seconds: 5 }], edits, creators, now);
  const long = implicitTaste([{ kind: 'dwell', editId: 'gym-1', at: now, seconds: 60 }], edits, creators, now);
  assert.ok(Math.abs(short.tags['strength-training'] - TASTE_LEARNING.weights.dwell * 5 / TASTE_LEARNING.dwellFullWeightSeconds) < 1e-9);
  assert.equal(long.tags['strength-training'], TASTE_LEARNING.weights.dwell);
});

test('Not interested hides the Edit and pushes its tags negative; rejected tags penalise other Edits', () => {
  const learned = implicitTaste([{ kind: 'notInterested', editId: 'cafe-3', at: now }], edits, creators, now);
  assert.ok(learned.dismissedEditIds.has('cafe-3'));
  assert.equal(learned.tags['table-setting'], TASTE_LEARNING.weights.notInterested);
  assert.ok(learned.rejectedTags.has('table-setting'));
  const explicit = { categories: ['Restaurants'], tags: ['table-setting', 'long-lunches'] };
  const plain = scoreEditForViewer(explicit, edits.get('cafe-4')).score;
  const penalised = scoreEditWithLearning(explicit, learned, edits.get('cafe-4')).score;
  assert.ok(penalised < plain, `${penalised} < ${plain}`);
  assert.ok(penalised >= 0);
});

test('the implicit selection needs enough weight; blend is 60/40 once it is scorable', () => {
  const explicit = { categories: ['Decor'], tags: ['calm-interiors', 'natural-light'] };
  // Only a single view of a café Edit: not enough to join the selection → explicit score stands alone.
  const faint = implicitTaste([{ kind: 'view', editId: 'cafe-2', at: now }], edits, creators, now);
  assert.deepEqual(faint.selection.tags, []);
  assert.equal(scoreEditWithLearning(explicit, faint, edits.get('cafe-1')).score, scoreEditForViewer(explicit, edits.get('cafe-1')).score);
  // Several saves of café Edits: the implicit selection now carries café tags, and café Edits rise.
  const strong = implicitTaste([
    { kind: 'save', editId: 'cafe-1', at: now }, { kind: 'save', editId: 'cafe-2', at: now }, { kind: 'circle', creatorId: 'cafe', at: now },
  ], edits, creators, now);
  assert.ok(strong.selection.tags.includes('coffee-stops'));
  assert.deepEqual(strong.selection.categories, ['Restaurants']);
  const before = scoreEditForViewer(explicit, edits.get('cafe-1')).score;
  const after = scoreEditWithLearning(explicit, strong, edits.get('cafe-1')).score;
  assert.equal(before, 0);
  const implicitOnly = scoreEditForViewer(strong.selection, edits.get('cafe-1')).score;
  assert.equal(after, Math.round(before * TASTE_LEARNING_BLEND.explicit + implicitOnly * TASTE_LEARNING_BLEND.implicit));
  assert.ok(after > before);
});

test('old signals fade: a 90-day-old save counts an eighth of a fresh one', () => {
  const fresh = implicitTaste([{ kind: 'save', editId: 'cafe-1', at: now }], edits, creators, now);
  const old = implicitTaste([{ kind: 'save', editId: 'cafe-1', at: daysAgo(90) }], edits, creators, now);
  assert.ok(Math.abs(old.tags['coffee-stops'] - fresh.tags['coffee-stops'] / 8) < 1e-9);
});

test('never by the numbers: the learner has no input for counts and ignores other members', () => {
  const learned = implicitTaste([{ kind: 'save', editId: 'cafe-1', at: now, likeCount: 1e6, followerCount: 1e6 }], edits, creators, now);
  const plain = implicitTaste([{ kind: 'save', editId: 'cafe-1', at: now }], edits, creators, now);
  assert.deepEqual(learned.tags, plain.tags);
});
