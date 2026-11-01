import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSecrets } from '../utils/redact';

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

test('redacts path-style API keys', () => {
  assert.equal(
    redactSecrets('POST https://eth-mainnet.g.alchemy.com/v2/AbCdEf1234567890123456789012 failed'),
    'POST https://eth-mainnet.g.alchemy.com/v2/*** failed'
  );
  assert.equal(
    redactSecrets('https://mainnet.infura.io/v3/0123456789abcdef0123456789abcdef'),
    'https://mainnet.infura.io/v3/***'
  );
});

test('redacts named query parameters', () => {
  assert.equal(redactSecrets('https://rpc.example.com/?apikey=supersecret'), 'https://rpc.example.com/?apikey=***');
  assert.equal(redactSecrets('https://rpc.example.com/?key=abc&chain=1'), 'https://rpc.example.com/?key=***&chain=1');
});

test('redacts basic-auth userinfo', () => {
  assert.equal(redactSecrets('https://user:pass@rpc.example.com'), 'https://***@rpc.example.com');
});

test('leaves normal error text and addresses intact', () => {
  const message = `failed to read the ETH balance of ${ADDRESS}`;
  assert.equal(redactSecrets(message), message);
});

test('redacts every occurrence in a multi-line message', () => {
  const text = [
    'request https://a.example/v2/AAAAAAAAAAAAAAAAAAAAAAAAAAAA failed',
    'retry https://b.example/v2/BBBBBBBBBBBBBBBBBBBBBBBBBBBB failed',
  ].join('\n');

  const redacted = redactSecrets(text);
  assert.ok(!redacted.includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
  assert.ok(!redacted.includes('BBBBBBBBBBBBBBBBBBBBBBBBBBBB'));
});
