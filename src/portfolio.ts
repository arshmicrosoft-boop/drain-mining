import { BigNumber, ethers } from 'ethers';
import { fetchBalances } from './balances';
import { resolveTokens, TokenMeta } from './tokens';
import type { AppConfig } from './utils/config';
import { Align, formatAmount, renderTable, shortAddress } from './utils/format';

export interface PortfolioColumn {
  /** Lowercase token address; also the key used in `PortfolioRow.tokens`. */
  token: string;
  label: string;
}

export interface PortfolioRow {
  address: string;
  /** Formatted ETH, or `n/a` when the read failed. */
  eth: string;
  /** Keyed by lowercase token address. `n/a` means the read failed. */
  tokens: Record<string, string>;
}

export interface PortfolioResult {
  blockNumber: number;
  columns: PortfolioColumn[];
  rows: PortfolioRow[];
  totals: { eth: string; tokens: Record<string, string> };
  /** True when at least one cell is `n/a`; totals then only cover readable values. */
  partial: boolean;
  /** Non-fatal problems worth surfacing, e.g. unresolvable token metadata. */
  warnings: string[];
}

const UNREADABLE = 'n/a';

/**
 * Column labels are unique even when two contracts report the same symbol, and
 * duplicates are disambiguated with their address prefix.
 */
export const buildColumns = (tokens: readonly TokenMeta[]): PortfolioColumn[] => {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token.symbol, (counts.get(token.symbol) ?? 0) + 1);

  return tokens.map((token) => ({
    token: token.address.toLowerCase(),
    label: (counts.get(token.symbol) ?? 1) > 1 ? `${token.symbol}(${token.address.slice(2, 6)})` : token.symbol,
  }));
};

/** One batched read of ETH + every tracked token for every address. */
export const buildPortfolio = async (
  config: AppConfig,
  provider: ethers.providers.Provider
): Promise<PortfolioResult> => {
  const addresses = config.watchAddresses;
  if (addresses.length === 0) {
    throw new Error('no addresses: set WATCH_ADDRESSES or pass --address');
  }

  const tokens = await resolveTokens(provider, config.tokens, config.concurrency);
  const [read, blockNumber] = await Promise.all([
    fetchBalances(provider, addresses, tokens, config.concurrency),
    provider.getBlockNumber(),
  ]);

  let ethTotal = BigNumber.from(0);
  let partial = false;
  const tokenTotals = new Map<string, BigNumber>();
  const warnings = tokens
    .filter((token) => !token.metadataResolved)
    .map((token) => `metadata for ${token.address} could not be read; assuming ${token.decimals} decimals`);

  const rows: PortfolioRow[] = addresses.map((address) => {
    const snapshot = read.snapshots.get(address.toLowerCase());
    const eth = snapshot?.eth;

    if (eth === undefined) {
      partial = true;
    } else {
      ethTotal = ethTotal.add(eth);
    }

    const cells: Record<string, string> = {};
    for (const token of tokens) {
      const key = token.address.toLowerCase();
      const balance = snapshot?.tokens.get(key);

      if (balance === undefined) {
        cells[key] = UNREADABLE;
        partial = true;
        continue;
      }

      cells[key] = formatAmount(balance, token.decimals);
      tokenTotals.set(key, (tokenTotals.get(key) ?? BigNumber.from(0)).add(balance));
    }

    return {
      address,
      eth: eth === undefined ? UNREADABLE : formatAmount(eth, 18),
      tokens: cells,
    };
  });

  const totalCells: Record<string, string> = {};
  for (const token of tokens) {
    const key = token.address.toLowerCase();
    const total = tokenTotals.get(key);
    totalCells[key] = total === undefined ? UNREADABLE : formatAmount(total, token.decimals);
  }

  return {
    blockNumber,
    columns: buildColumns(tokens),
    rows,
    totals: { eth: formatAmount(ethTotal, 18), tokens: totalCells },
    partial,
    warnings,
  };
};

export const renderPortfolio = (result: PortfolioResult): string => {
  const headers = ['address', 'ETH', ...result.columns.map((column) => column.label)];
  const aligns: Align[] = ['left', 'right', ...result.columns.map(() => 'right' as Align)];

  const rows = result.rows.map((row) => [
    shortAddress(row.address, 10, 8),
    row.eth,
    ...result.columns.map((column) => row.tokens[column.token] ?? UNREADABLE),
  ]);

  rows.push([
    'total',
    result.totals.eth,
    ...result.columns.map((column) => result.totals.tokens[column.token] ?? UNREADABLE),
  ]);

  return renderTable(headers, rows, aligns);
};
