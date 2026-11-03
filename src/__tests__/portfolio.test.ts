import assert from 'node:assert/strict';
import test from 'node:test';
import { buildColumns } from '../portfolio';
import type { TokenMeta } from '../tokens';

const meta = (address: string, symbol: string): TokenMeta => ({ address, symbol, decimals: 6, metadataResolved: true });

const USDC_A = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_B = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

test('buildColumns keys columns by address, not symbol', () => {
  const columns = buildColumns([meta(USDC_A, 'USDC'), meta(USDC_B, 'USDC'), meta(DAI, 'DAI')]);

  assert.deepEqual(
    columns.map((column) => column.token),
    [USDC_A.toLowerCase(), USDC_B.toLowerCase(), DAI.toLowerCase()]
  );
});

test('buildColumns disambiguates duplicate symbols so cells cannot collide', () => {
  const columns = buildColumns([meta(USDC_A, 'USDC'), meta(USDC_B, 'USDC'), meta(DAI, 'DAI')]);
  const labels = columns.map((column) => column.label);

  assert.equal(new Set(labels).size, labels.length, 'labels must be unique');
  assert.equal(labels[2], 'DAI');
  assert.match(labels[0], /^USDC\(/);
  assert.match(labels[1], /^USDC\(/);
});

test('buildColumns leaves unique symbols alone', () => {
  const columns = buildColumns([meta(DAI, 'DAI')]);
  assert.equal(columns[0].label, 'DAI');
});
