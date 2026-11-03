import assert from 'node:assert/strict';
import test from 'node:test';
import { BigNumber } from 'ethers';
import { formatAmount, formatSigned, renderTable, sanitizeLabel, shortAddress } from '../utils/format';

test('formatAmount trims trailing zeros', () => {
  assert.equal(formatAmount('1234500000000000000', 18), '1.2345');
  assert.equal(formatAmount('1000000', 6), '1');
  assert.equal(formatAmount('0', 18), '0');
});

test('formatAmount caps the fraction', () => {
  assert.equal(formatAmount('1234567890000000000', 18, 4), '1.2345');
  assert.equal(formatAmount('1234567890000000000', 18, 0), '1');
});

test('formatAmount never renders a non-zero value as zero', () => {
  assert.equal(formatAmount(BigNumber.from(1), 18), '<0.000001');
  assert.equal(formatAmount(BigNumber.from(1), 18, 0), '<1');
  assert.equal(formatAmount(BigNumber.from('1000000'), 6), '1');
});

test('formatSigned signs real deltas and leaves zero unsigned', () => {
  assert.equal(formatSigned(BigNumber.from('1500000'), 6), '+1.5');
  assert.equal(formatSigned(BigNumber.from('-1500000'), 6), '-1.5');
  assert.equal(formatSigned(BigNumber.from('0'), 6), '0');
});

test('formatSigned keeps sub-unit deltas visible', () => {
  assert.equal(formatSigned(BigNumber.from(1), 18), '+<0.000001');
  assert.equal(formatSigned(BigNumber.from(-1), 18), '-<0.000001');
});

test('shortAddress abbreviates long addresses only', () => {
  assert.equal(shortAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'), '0xd8dA...6045');
  assert.equal(shortAddress('0x1234', 2, 2), '0x1234');
});

test('sanitizeLabel strips control characters used for terminal escapes', () => {
  assert.equal(sanitizeLabel('USDC\u0000\u001b[31m'), 'USDC[31m');
  assert.equal(sanitizeLabel('\u0000\u0007'), '');
  assert.equal(sanitizeLabel('  USDC  '), 'USDC');
});

test('sanitizeLabel caps width and marks truncation', () => {
  const label = sanitizeLabel('X'.repeat(20), 12);
  assert.equal(label.length, 12);
  assert.equal(label, `${'X'.repeat(11)}~`);
});

test('renderTable pads columns and strips trailing spaces', () => {
  const table = renderTable(['a', 'bb'], [['1', '2']], ['left', 'right']);
  assert.equal(table, 'a  bb\n-  --\n1   2');
  for (const line of table.split('\n')) {
    assert.equal(line, line.trimEnd());
  }
});
