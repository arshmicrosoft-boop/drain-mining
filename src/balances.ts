import { BigNumber, ethers } from 'ethers';
import { ERC20_ABI, MULTICALL3_ABI, MULTICALL3_ADDRESS } from './abi';
import type { TokenMeta } from './tokens';
import { mapLimit, withRetry } from './utils/async';

export interface Snapshot {
  address: string;
  eth: BigNumber;
  /** Keyed by lowercase token address. Absent means "could not be read". */
  tokens: Map<string, BigNumber>;
}

export interface BalanceRead {
  /** Only addresses whose ETH balance was readable. Never contains a guessed 0. */
  snapshots: Map<string, Snapshot>;
  /** Lowercase addresses whose ETH read failed this poll. */
  unreadableEth: string[];
  /** Lowercase token address -> lowercase holders whose token read failed. */
  unreadableTokens: Map<string, string[]>;
}

export type ChangeKind = 'eth' | 'token';

export interface BalanceChange {
  address: string;
  kind: ChangeKind;
  token?: TokenMeta;
  previous: BigNumber;
  delta: BigNumber;
  current: BigNumber;
}

const erc20Interface = new ethers.utils.Interface(ERC20_ABI);
const multicallInterface = new ethers.utils.Interface(MULTICALL3_ABI);

/** Calls per aggregate3 payload. Large enough to amortise, small enough to be accepted. */
const CALLS_PER_REQUEST = 100;

interface Call {
  target: string;
  allowFailure: boolean;
  callData: string;
}

interface CallResult {
  success: boolean;
  data: string;
}

type ReadEntry =
  | { kind: 'eth'; holder: string }
  | { kind: 'token'; holder: string; token: string };

export class MulticallUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MulticallUnavailableError';
  }
}

/**
 * True when the failure means "this chain/provider cannot do deployless
 * multicall", which is the only case worth retrying individually. Auth errors,
 * timeouts and rate limits are rethrown so a provider outage does not turn one
 * failed call into 3xN retries.
 */
const isMulticallUnavailable = (error: unknown): boolean => {
  if (error instanceof MulticallUnavailableError) return true;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /revert|invalid opcode|not deployed|no data|does not exist/.test(message);
};

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

/** Undefined instead of a silent zero when the payload is not a uint256. */
const parseUint = (data: string): BigNumber | undefined => {
  if (!data || data === '0x') return undefined;
  try {
    return BigNumber.from(data);
  } catch {
    return undefined;
  }
};

const sendMulticall = async (
  provider: ethers.providers.Provider,
  calls: readonly Call[]
): Promise<CallResult[]> => {
  const data = multicallInterface.encodeFunctionData('aggregate3', [calls]);
  const raw = await provider.call({ to: MULTICALL3_ADDRESS, data });

  if (!raw || raw === '0x') {
    throw new MulticallUnavailableError('multicall3 returned no data (contract not deployed on this network?)');
  }

  const entries = multicallInterface.decodeFunctionResult('aggregate3', raw)[0] as unknown as ReadonlyArray<
    ReadonlyArray<unknown>
  >;

  return entries.map((entry) => ({
    success: Boolean(entry[0]),
    data: typeof entry[1] === 'string' ? entry[1] : '0x',
  }));
};

/** Batched, chunked, concurrency-limited multicall. Throws if any chunk fails. */
const runCalls = async (
  provider: ethers.providers.Provider,
  calls: readonly Call[],
  concurrency: number
): Promise<CallResult[]> => {
  if (calls.length === 0) return [];

  const batches = chunk(calls, CALLS_PER_REQUEST);
  const settled = await mapLimit(batches, concurrency, (batch) => sendMulticall(provider, batch));

  const results: CallResult[] = [];
  for (const entry of settled) {
    if (!entry.ok) throw entry.error;
    results.push(...entry.value);
  }
  return results;
};

/** Plan every read (ETH + every token for every holder) as one flat call list. */
const planReads = (addresses: readonly string[], tokens: readonly TokenMeta[]): ReadEntry[] => {
  const entries: ReadEntry[] = [];

  for (const address of addresses) {
    entries.push({ kind: 'eth', holder: address });
  }
  for (const token of tokens) {
    for (const address of addresses) {
      entries.push({ kind: 'token', holder: address, token: token.address });
    }
  }
  return entries;
};

const toCall = (entry: ReadEntry): Call => {
  if (entry.kind === 'eth') {
    return {
      target: MULTICALL3_ADDRESS,
      allowFailure: true,
      callData: multicallInterface.encodeFunctionData('getEthBalance', [entry.holder]),
    };
  }
  return {
    target: entry.token,
    allowFailure: true,
    callData: erc20Interface.encodeFunctionData('balanceOf', [entry.holder]),
  };
};

const readIndividually = async (
  provider: ethers.providers.Provider,
  entries: readonly ReadEntry[],
  concurrency: number
): Promise<Array<BigNumber | undefined>> => {
  const contracts = new Map<string, ethers.Contract>();

  const settled = await mapLimit(entries, concurrency, async (entry) => {
    if (entry.kind === 'eth') {
      return withRetry(() => provider.getBalance(entry.holder), { attempts: 3 });
    }

    const key = entry.token.toLowerCase();
    const existing = contracts.get(key);
    const contract = existing ?? new ethers.Contract(entry.token, ERC20_ABI, provider);
    if (!existing) contracts.set(key, contract);

    return withRetry(() => contract.balanceOf(entry.holder) as Promise<BigNumber>, { attempts: 2 });
  });

  return settled.map((result) => (result.ok ? result.value : undefined));
};

const readAll = async (
  provider: ethers.providers.Provider,
  entries: readonly ReadEntry[],
  concurrency: number
): Promise<Array<BigNumber | undefined>> => {
  const calls = entries.map(toCall);

  try {
    const results = await runCalls(provider, calls, concurrency);
    return results.map((result) => (result.success ? parseUint(result.data) : undefined));
  } catch (error) {
    if (!isMulticallUnavailable(error)) throw error;
    return readIndividually(provider, entries, concurrency);
  }
};

/**
 * Read ETH and token balances for many addresses in one batched pipeline.
 *
 * A failed read is reported through `unreadableEth` / `unreadableTokens` and
 * omitted from the snapshot. It is never coerced to zero, because a zero would
 * be indistinguishable from a real drain and would fire a false alert.
 */
export const fetchBalances = async (
  provider: ethers.providers.Provider,
  addresses: readonly string[],
  tokens: readonly TokenMeta[],
  concurrency: number
): Promise<BalanceRead> => {
  const entries = planReads(addresses, tokens);
  const values = await readAll(provider, entries, concurrency);

  const ethByHolder = new Map<string, BigNumber>();
  const tokensByHolder = new Map<string, Map<string, BigNumber>>();
  const unreadableEth: string[] = [];
  const unreadableTokens = new Map<string, string[]>();

  entries.forEach((entry, index) => {
    const holder = entry.holder.toLowerCase();
    const value = values[index];

    if (value === undefined) {
      if (entry.kind === 'eth') {
        unreadableEth.push(holder);
      } else {
        const token = entry.token.toLowerCase();
        const holders = unreadableTokens.get(token) ?? [];
        holders.push(holder);
        unreadableTokens.set(token, holders);
      }
      return;
    }

    if (entry.kind === 'eth') {
      ethByHolder.set(holder, value);
    } else {
      const token = entry.token.toLowerCase();
      const perHolder = tokensByHolder.get(holder) ?? new Map<string, BigNumber>();
      perHolder.set(token, value);
      tokensByHolder.set(holder, perHolder);
    }
  });

  if (addresses.length > 0 && ethByHolder.size === 0) {
    throw new Error(`could not read the ETH balance of any of ${addresses.length} address(es) - provider problem?`);
  }

  const snapshots = new Map<string, Snapshot>();
  for (const address of addresses) {
    const key = address.toLowerCase();
    const eth = ethByHolder.get(key);
    if (eth === undefined) continue;

    snapshots.set(key, {
      address,
      eth,
      tokens: tokensByHolder.get(key) ?? new Map<string, BigNumber>(),
    });
  }

  return { snapshots, unreadableEth, unreadableTokens };
};

/**
 * Pure diff of two snapshots. Only compares readings present in both, so an
 * unreadable balance never masquerades as a drop to zero.
 */
export const diffSnapshots = (
  previous: ReadonlyMap<string, Snapshot> | undefined,
  next: ReadonlyMap<string, Snapshot>,
  tokens: readonly TokenMeta[]
): BalanceChange[] => {
  if (!previous) return [];

  const tokenIndex = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
  const changes: BalanceChange[] = [];

  for (const [key, snapshot] of next) {
    const before = previous.get(key);
    if (!before) continue;

    if (!before.eth.eq(snapshot.eth)) {
      changes.push({
        address: snapshot.address,
        kind: 'eth',
        previous: before.eth,
        current: snapshot.eth,
        delta: snapshot.eth.sub(before.eth),
      });
    }

    for (const [tokenKey, current] of snapshot.tokens) {
      const prior = before.tokens.get(tokenKey);
      if (prior === undefined || prior.eq(current)) continue;

      const change: BalanceChange = {
        address: snapshot.address,
        kind: 'token',
        previous: prior,
        current,
        delta: current.sub(prior),
      };

      const meta = tokenIndex.get(tokenKey);
      if (meta) change.token = meta;
      changes.push(change);
    }
  }

  return changes;
};
