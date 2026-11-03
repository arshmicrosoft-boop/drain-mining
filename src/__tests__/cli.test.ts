import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from '../cli';

test('parseArgs reads a command and its flags', () => {
  const args = parseArgs(['monitor', '--once', '--address', '0xa,0xb', '--tokens', 'USDC:0xc']);
  assert.equal(args.command, 'monitor');
  assert.equal(args.once, true);
  assert.deepEqual(args.addresses, ['0xa', '0xb']);
  assert.equal(args.tokens, 'USDC:0xc');
});

test('parseArgs defaults are quiet-safe', () => {
  const args = parseArgs(['portfolio']);
  assert.equal(args.command, 'portfolio');
  assert.equal(args.json, false);
  assert.equal(args.once, false);
  assert.equal(args.help, false);
  assert.equal(args.toConsole, true);
  assert.deepEqual(args.addresses, []);
});

test('parseArgs supports --json, --quiet and --help', () => {
  assert.equal(parseArgs(['portfolio', '--json']).json, true);
  assert.equal(parseArgs(['monitor', '--quiet']).toConsole, false);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs splits repeated --address flags', () => {
  const args = parseArgs(['monitor', '--address', '0xa', '--address', '0xb,0xc']);
  assert.deepEqual(args.addresses, ['0xa', '0xb', '0xc']);
});

test('parseArgs rejects unknown input loudly', () => {
  assert.throws(() => parseArgs(['drain']), /unknown command: drain/);
  assert.throws(() => parseArgs(['monitor', '--wat']), /unknown option: --wat/);
  assert.throws(() => parseArgs(['monitor', '--address']), /--address requires a value/);
  assert.throws(() => parseArgs(['monitor', '--tokens']), /--tokens requires a value/);
});
