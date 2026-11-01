import assert from 'node:assert/strict';
import test from 'node:test';
import { BigNumber } from 'ethers';
import { diffSnapshots, Snapshot } from '../balances';
import type { TokenMeta } from '../tokens';

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const KEY = ADDRESS.toLowerCase();
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_KEY = USDC_ADDRESS.toLowerCase();

const USDC: TokenMeta = { address: USDC_ADDRESS, symbol: 'USDC', decimals: 6, metadataResolved: true };

const snapshot = (eth: string, tokens: Record<string, string> = {}): Map<string, Snapshot> => {
  const balances = new Map<string, BigNumber>();
  for (const [token, value] of Object.entries(tokens)) balances.set(token, BigNumber.from(value));
  return new Map([[KEY, { address: ADDRESS, eth: BigNumber.from(eth), tokens: balances }]]);
};

test('diffSnapshots reports nothing without a previous reading', () => {
  assert.deepEqual(diffSnapshots(undefined, snapshot('100'), [USDC]), []);
});

test('diffSnapshots reports unchanged balances as no change', () => {
  assert.deepEqual(diffSnapshots(snapshot('100'), snapshot('100'), [USDC]), []);
});

test('diffSnapshots computes ETH deltas in both directions', () => {
  const up = diffSnapshots(snapshot('100'), snapshot('250'), []);
  assert.equal(up.length, 1);
  assert.equal(up[0].kind, 'eth');
  assert.equal(up[0].delta.toString(), '150');
  assert.equal(up[0].current.toString(), '250');

  const down = diffSnapshots(snapshot('250'), snapshot('100'), []);
  assert.equal(down[0].delta.toString(), '-150');
});

test('diffSnapshots attaches token metadata', () => {
  const changes = diffSnapshots(
    snapshot('0', { [USDC_KEY]: '0' }),
    snapshot('0', { [USDC_KEY]: '5000000' }),
    [USDC]
  );

  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'token');
  assert.equal(changes[0].token?.symbol, 'USDC');
  assert.equal(changes[0].delta.toString(), '5000000');
});

test('diffSnapshots ignores tokens that could not be read this poll', () => {
  // Previous poll saw 5 USDC; this poll the token call failed and is absent.
  // That must not be reported as a drop to zero.
  const changes = diffSnapshots(snapshot('0', { [USDC_KEY]: '5000000' }), snapshot('0'), [USDC]);
  assert.deepEqual(changes, []);
});

test('diffSnapshots ignores addresses that vanished from the watch list', () => {
  const changes = diffSnapshots(snapshot('100'), new Map(), [USDC]);
  assert.deepEqual(changes, []);
});

test('diffSnapshots reports a genuine drain to zero', () => {
  const changes = diffSnapshots(snapshot('100'), snapshot('0'), []);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].delta.toString(), '-100');
});
