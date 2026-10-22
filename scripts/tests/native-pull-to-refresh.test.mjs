import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PULL_MAX, PULL_THRESHOLD, canStartPull, pullDistance, pullProgress, shouldRefresh } from '../../artifacts/tastekin/src/lib/pull-to-refresh.ts';

test('indicator follows the finger 1:1 up to the threshold, then with resistance, never past the cap', () => {
  assert.equal(pullDistance(0), 0);
  assert.equal(pullDistance(-20), 0);
  assert.equal(pullDistance(40), 40);
  assert.equal(pullDistance(PULL_THRESHOLD), PULL_THRESHOLD);
  const beyond = pullDistance(PULL_THRESHOLD + 100);
  assert.ok(beyond > PULL_THRESHOLD && beyond < PULL_THRESHOLD + 100, String(beyond));
  assert.equal(pullDistance(10_000), PULL_MAX);
});

test('progress is clamped to 0..1 and refresh arms exactly at the threshold', () => {
  assert.equal(pullProgress(-5), 0);
  assert.equal(pullProgress(PULL_THRESHOLD / 2), 0.5);
  assert.equal(pullProgress(PULL_THRESHOLD * 3), 1);
  assert.equal(shouldRefresh(PULL_THRESHOLD - 1), false);
  assert.equal(shouldRefresh(PULL_THRESHOLD), true);
});

test('a pull can only start at the top of the page and never while typing', () => {
  assert.equal(canStartPull(0, 'DIV'), true);
  assert.equal(canStartPull(0, undefined), true);
  assert.equal(canStartPull(1, 'DIV'), false);
  assert.equal(canStartPull(0, 'INPUT'), false);
  assert.equal(canStartPull(0, 'textarea'), false);
});
