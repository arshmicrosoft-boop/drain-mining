import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig, parseAddressList, parseTokens } from '../utils/config';

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

test('parseAddressList validates, checksums and de-duplicates', () => {
  const parsed = parseAddressList(`${VITALIK}, ${VITALIK.toLowerCase()}`, 'watch address');
  assert.deepEqual(parsed, [VITALIK]);
});

test('parseAddressList rejects malformed addresses', () => {
  assert.throws(() => parseAddressList('0x123', 'watch address'), /Invalid watch address/);
  assert.throws(() => parseAddressList('not-an-address'), /Invalid address/);
});

test('parseAddressList ignores empty input', () => {
  assert.deepEqual(parseAddressList('  ,  '), []);
  assert.deepEqual(parseAddressList(''), []);
});

test('parseTokens handles symbol overrides and bare addresses', () => {
  const tokens = parseTokens(`USDC:${USDC}, ${USDT}`);
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0].symbol, 'USDC');
  assert.equal(tokens[0].address, USDC);
  assert.equal(tokens[1].symbol, undefined);
  assert.equal(tokens[1].address, USDT);
});

test('parseTokens rejects garbage', () => {
  assert.throws(() => parseTokens('USDC:0xdead'), /Invalid token entry/);
});

test('loadConfig fills in defaults', () => {
  const config = loadConfig({
    env: { PROVIDER_URL: 'https://rpc.example.com/v2/key', WATCH_ADDRESSES: VITALIK } as NodeJS.ProcessEnv,
  });

  assert.equal(config.watchAddresses.length, 1);
  assert.equal(config.pollIntervalMs, 15_000);
  assert.equal(config.concurrency, 8);
  assert.equal(config.logDir, './logs');
  assert.equal(config.webhookURL, undefined);
  assert.deepEqual(config.tokens, []);
});

test('loadConfig requires a provider URL', () => {
  assert.throws(() => loadConfig({ env: {} as NodeJS.ProcessEnv }), /PROVIDER_URL is not set/);
});

test('loadConfig rejects non-http provider protocols', () => {
  assert.throws(
    () => loadConfig({ env: { PROVIDER_URL: 'ftp://nope' } as NodeJS.ProcessEnv }),
    /must use https: or http: or wss: or ws:/
  );
});

test('loadConfig validates private keys and integers', () => {
  const base = { PROVIDER_URL: 'https://rpc.example.com' };

  assert.throws(
    () => loadConfig({ env: { ...base, PRIVATE_KEY: '0xabc' } as NodeJS.ProcessEnv }),
    /PRIVATE_KEY must be/
  );
  assert.throws(
    () => loadConfig({ env: { ...base, POLL_INTERVAL_MS: 'abc' } as NodeJS.ProcessEnv }),
    /POLL_INTERVAL_MS must be an integer/
  );
  assert.throws(
    () => loadConfig({ env: { ...base, CONCURRENCY: '0' } as NodeJS.ProcessEnv }),
    /CONCURRENCY must be an integer/
  );
});
