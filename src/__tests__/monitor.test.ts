import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPollDelay } from '../monitor';

test('healthy polls target a fixed start-to-start interval', () => {
  assert.equal(nextPollDelay(15_000, 0, 0), 15_000);
  assert.equal(nextPollDelay(15_000, 0, 4_000), 11_000);
});

test('a slow poll does not stack a delay on top of itself', () => {
  assert.equal(nextPollDelay(15_000, 0, 20_000), 0);
});

test('failures double the delay', () => {
  assert.equal(nextPollDelay(1_000, 1, 0), 2_000);
  assert.equal(nextPollDelay(1_000, 2, 0), 4_000);
  assert.equal(nextPollDelay(1_000, 3, 0), 8_000);
});

test('backoff is capped at five minutes', () => {
  assert.equal(nextPollDelay(60_000, 9, 0), 300_000);
  assert.equal(nextPollDelay(15_000, 20, 0), 300_000);
});
