import assert from 'node:assert/strict';
import test from 'node:test';
import { BigNumber, ethers } from 'ethers';
import { ERC20_ABI, MULTICALL3_ABI, MULTICALL3_ADDRESS } from '../abi';
import { fetchBalances } from '../balances';
import type { TokenMeta } from '../tokens';

const multicallInterface = new ethers.utils.Interface(MULTICALL3_ABI);
const erc20Interface = new ethers.utils.Interface(ERC20_ABI);

const HOLDER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const HOLDER_2 = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const usdc: TokenMeta = { address: TOKEN, symbol: 'USDC', decimals: 6, metadataResolved: true };

interface StubOptions {
  eth?: Record<string, string>;
  tokens?: Record<string, Record<string, string>>;
  /** Holders whose getEthBalance sub-call reports success: false. */
  failEth?: string[];
  /** Holders whose getEthBalance returns success: true with empty data. */
  emptyEth?: string[];
  /** Token/holder pairs whose balanceOf reports success: false. */
  failTokens?: Array<{ token: string; holder: string }>;
  mode?: 'multicall' | 'unavailable' | 'error';
}

const encodeUint = (value: string): string =>
  ethers.utils.hexZeroPad(BigNumber.from(value).toHexString(), 32);

const createStub = (options: StubOptions = {}) => {
  const state = { multicalls: 0, individualBalances: 0 };

  const provider = {
    _isProvider: true,
    call: async (tx: { to?: string; data?: string }) => {
      state.multicalls += 1;

      if (options.mode === 'error') throw new Error('unauthorized: invalid api key');
      if (options.mode === 'unavailable') return '0x';

      const decoded = multicallInterface.decodeFunctionData('aggregate3', tx.data as string);
      const calls = decoded[0] as unknown as Array<{ target: string; callData: string }>;

      const results = calls.map((entry) => {
        const target = entry.target.toLowerCase();

        if (target === MULTICALL3_ADDRESS.toLowerCase()) {
          const args = multicallInterface.decodeFunctionData('getEthBalance', entry.callData) as unknown as [string];
          const holder = args[0].toLowerCase();

          if (options.failEth?.includes(holder)) return [false, '0x'];
          if (options.emptyEth?.includes(holder)) return [true, '0x'];
          return [true, encodeUint(options.eth?.[holder] ?? '0')];
        }

        const args = erc20Interface.decodeFunctionData('balanceOf', entry.callData) as unknown as [string];
        const holder = args[0].toLowerCase();
        const failed = options.failTokens?.some(
          (entry_) => entry_.token.toLowerCase() === target && entry_.holder.toLowerCase() === holder
        );

        if (failed) return [false, '0x'];
        const amount = options.tokens?.[target]?.[holder];
        if (amount === undefined) return [false, '0x'];
        return [true, encodeUint(amount)];
      });

      return multicallInterface.encodeFunctionResult('aggregate3', [results]);
    },
    getBalance: async (address: string) => {
      state.individualBalances += 1;
      const value = options.eth?.[address.toLowerCase()];
      if (value === undefined) throw new Error(`no stub balance for ${address}`);
      return BigNumber.from(value);
    },
  };

  return { provider: provider as unknown as ethers.providers.Provider, state };
};

test('a failed ETH sub-call omits the address instead of reporting zero', async () => {
  const stub = createStub({
    eth: { [HOLDER.toLowerCase()]: '100', [HOLDER_2.toLowerCase()]: '50' },
    failEth: [HOLDER_2.toLowerCase()],
  });

  const read = await fetchBalances(stub.provider, [HOLDER, HOLDER_2], [], 2);

  assert.equal(read.snapshots.size, 1);
  assert.equal(read.snapshots.get(HOLDER.toLowerCase())?.eth.toString(), '100');
  assert.equal(read.snapshots.has(HOLDER_2.toLowerCase()), false);
  assert.deepEqual(read.unreadableEth, [HOLDER_2.toLowerCase()]);
});

test('a success:true call with empty data is unreadable, not zero', async () => {
  const stub = createStub({
    eth: { [HOLDER.toLowerCase()]: '100', [HOLDER_2.toLowerCase()]: '0' },
    emptyEth: [HOLDER_2.toLowerCase()],
  });

  const read = await fetchBalances(stub.provider, [HOLDER, HOLDER_2], [], 2);

  assert.equal(read.snapshots.has(HOLDER_2.toLowerCase()), false);
  assert.deepEqual(read.unreadableEth, [HOLDER_2.toLowerCase()]);
  // The readable address is unaffected.
  assert.equal(read.snapshots.get(HOLDER.toLowerCase())?.eth.toString(), '100');
});

test('a real zero balance is kept as zero', async () => {
  const stub = createStub({ eth: { [HOLDER.toLowerCase()]: '0' } });

  const read = await fetchBalances(stub.provider, [HOLDER], [], 1);

  assert.equal(read.snapshots.get(HOLDER.toLowerCase())?.eth.toString(), '0');
  assert.deepEqual(read.unreadableEth, []);
});

test('unreadable token balances are reported and omitted', async () => {
  const stub = createStub({
    eth: { [HOLDER.toLowerCase()]: '100', [HOLDER_2.toLowerCase()]: '50' },
    tokens: { [TOKEN.toLowerCase()]: { [HOLDER.toLowerCase()]: '5000000' } },
    failTokens: [{ token: TOKEN, holder: HOLDER_2 }],
  });

  const read = await fetchBalances(stub.provider, [HOLDER, HOLDER_2], [usdc], 2);

  assert.equal(read.snapshots.get(HOLDER.toLowerCase())?.tokens.get(TOKEN.toLowerCase())?.toString(), '5000000');
  assert.equal(read.snapshots.get(HOLDER_2.toLowerCase())?.tokens.size, 0);
  assert.deepEqual(read.unreadableTokens.get(TOKEN.toLowerCase()), [HOLDER_2.toLowerCase()]);
});

test('falls back to individual reads when multicall is unavailable', async () => {
  const stub = createStub({ mode: 'unavailable', eth: { [HOLDER.toLowerCase()]: '7' } });

  const read = await fetchBalances(stub.provider, [HOLDER], [], 1);

  assert.equal(read.snapshots.get(HOLDER.toLowerCase())?.eth.toString(), '7');
  assert.equal(stub.state.individualBalances, 1);
});

test('a provider error is not amplified into per-address retries', async () => {
  const stub = createStub({ mode: 'error' });

  await assert.rejects(() => fetchBalances(stub.provider, [HOLDER, HOLDER_2], [], 2), /invalid api key/);

  assert.equal(stub.state.multicalls, 1);
  assert.equal(stub.state.individualBalances, 0);
});

test('throws when no ETH balance at all could be read', async () => {
  const stub = createStub({ failEth: [HOLDER.toLowerCase()] });

  await assert.rejects(() => fetchBalances(stub.provider, [HOLDER], [], 1), /could not read the ETH balance/);
});
