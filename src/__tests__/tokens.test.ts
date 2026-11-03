import assert from 'node:assert/strict';
import test from 'node:test';
import { ethers } from 'ethers';
import { ERC20_ABI } from '../abi';
import { resolveTokens } from '../tokens';

const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const interface_ = new ethers.utils.Interface(ERC20_ABI);

interface StubOptions {
  symbol?: string;
  decimals?: number;
}

/** Minimal provider stub: answers symbol()/decimals() calls, throws otherwise. */
const createStub = (options: StubOptions) => {
  const provider = {
    _isProvider: true,
    call: async (tx: { data: string }) => {
      const parsed = interface_.parseTransaction({ data: tx.data });
      if (!parsed) throw new Error('unexpected call data');

      if (parsed.name === 'symbol') {
        if (options.symbol === undefined) throw new Error('execution reverted');
        return ethers.utils.defaultAbiCoder.encode(['string'], [options.symbol]);
      }
      if (parsed.name === 'decimals') {
        if (options.decimals === undefined) throw new Error('execution reverted');
        return ethers.utils.defaultAbiCoder.encode(['uint8'], [options.decimals]);
      }
      throw new Error(`unexpected function ${parsed.name}`);
    },
  };

  return provider as unknown as ethers.providers.Provider;
};

test('resolves symbol and decimals from the contract', async () => {
  const tokens = await resolveTokens(createStub({ symbol: 'USDC', decimals: 6 }), [{ address: TOKEN }], 1);

  assert.equal(tokens[0].symbol, 'USDC');
  assert.equal(tokens[0].decimals, 6);
  assert.equal(tokens[0].metadataResolved, true);
});

test('sanitises hostile symbols from untrusted contracts', async () => {
  const tokens = await resolveTokens(
    createStub({ symbol: '\u001b[31mEVIL'.padEnd(40, 'X'), decimals: 18 }),
    [{ address: TOKEN }],
    1
  );

  assert.ok(!/[\u0000-\u001f]/.test(tokens[0].symbol), 'control characters must be stripped');
  assert.ok(tokens[0].symbol.length <= 12, 'label must be length-capped');
});

test('falls back to the configured symbol when the contract cannot answer', async () => {
  const tokens = await resolveTokens(createStub({ decimals: 18 }), [{ address: TOKEN, symbol: 'USDC' }], 1);

  assert.equal(tokens[0].symbol, 'USDC');
  assert.equal(tokens[0].metadataResolved, false);
});

test('falls back to 18 decimals but flags that metadata was not resolved', async () => {
  const tokens = await resolveTokens(createStub({ symbol: 'XNFT' }), [{ address: TOKEN }], 1);

  assert.equal(tokens[0].decimals, 18);
  assert.equal(tokens[0].metadataResolved, false);
});
