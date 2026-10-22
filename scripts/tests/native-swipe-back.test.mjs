import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backProgress, evaluateSwipe, isEdgeStart, resolveIntent, EDGE_WIDTH } from '../../artifacts/tastekin/src/lib/swipe-back.ts';

const W = 390; // iPhone 15 points

test('only touches on the leading edge start a swipe (left in LTR, right in RTL)', () => {
  assert.equal(isEdgeStart(4, W, false), true);
  assert.equal(isEdgeStart(EDGE_WIDTH, W, false), true);
  assert.equal(isEdgeStart(EDGE_WIDTH + 1, W, false), false);
  assert.equal(isEdgeStart(W - 4, W, true), true);
  assert.equal(isEdgeStart(4, W, true), false);
  assert.equal(isEdgeStart(4, 0, false), false);
});

test('progress follows the back direction only', () => {
  assert.equal(backProgress(80, false), 80);
  assert.equal(backProgress(-80, false), 0);
  assert.equal(backProgress(-80, true), 80);
  assert.equal(backProgress(80, true), 0);
});

test('a long drag commits, a short one cancels', () => {
  assert.equal(evaluateSwipe({ progress: W * 0.35, width: W, elapsedMs: 600 }), 'commit');
  assert.equal(evaluateSwipe({ progress: W * 0.2, width: W, elapsedMs: 600 }), 'cancel');
  assert.equal(evaluateSwipe({ progress: 0, width: W, elapsedMs: 100 }), 'cancel');
});

test('a quick flick commits even when short', () => {
  assert.equal(evaluateSwipe({ progress: 60, width: W, elapsedMs: 100 }), 'commit'); // 0.6 px/ms
  assert.equal(evaluateSwipe({ progress: 60, width: W, elapsedMs: 400 }), 'cancel'); // 0.15 px/ms
  assert.equal(evaluateSwipe({ progress: 30, width: W, elapsedMs: 20 }), 'cancel'); // fast but under the minimum distance
});

test('intent: vertical movement wins (scroll), backwards horizontal is not a swipe', () => {
  assert.equal(resolveIntent(3, 4, false), 'undecided');
  assert.equal(resolveIntent(20, 5, false), 'horizontal');
  assert.equal(resolveIntent(5, 20, false), 'vertical');
  assert.equal(resolveIntent(-20, 5, false), 'vertical'); // leftwards in LTR: not back
  assert.equal(resolveIntent(-20, 5, true), 'horizontal'); // leftwards in RTL: back
});
