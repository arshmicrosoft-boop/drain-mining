import assert from 'node:assert/strict';
import test from 'node:test';
import { mapLimit, Settled, sleep, withRetry } from '../utils/async';

const unwrap = <T>(results: Array<Settled<T>>): T[] =>
  results.map((result) => {
    if (!result.ok) throw result.error;
    return result.value;
  });

test('mapLimit preserves input order', async () => {
  const items = [5, 1, 4, 2, 3];
  const results = await mapLimit(items, 2, async (item) => {
    await sleep(item * 2);
    return item * 10;
  });

  assert.deepEqual(unwrap(results), [50, 10, 40, 20, 30]);
});

test('mapLimit never exceeds the concurrency limit', async () => {
  let active = 0;
  let peak = 0;

  await mapLimit(Array.from({ length: 12 }, (_, index) => index), 3, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(5);
    active -= 1;
    return true;
  });

  assert.equal(peak, 3);
});

test('mapLimit captures per-item failures without aborting the batch', async () => {
  const results = await mapLimit([1, 2, 3, 4], 2, async (item) => {
    if (item === 2) throw new Error('boom');
    return item;
  });

  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[2].ok, true);
  assert.equal(results[3].ok, true);
  assert.deepEqual(unwrap(results.filter((result) => result.ok)), [1, 3, 4]);
});

test('mapLimit rejects an invalid limit', async () => {
  await assert.rejects(() => mapLimit([1], 0, async (item) => item), /concurrency limit/);
});

test('withRetry succeeds after transient failures', async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    },
    { attempts: 3, baseDelayMs: 1 }
  );

  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('withRetry gives up after the configured attempts', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error('always');
        },
        { attempts: 2, baseDelayMs: 1 }
      ),
    /always/
  );
  assert.equal(calls, 2);
});
