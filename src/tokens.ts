import { ethers } from 'ethers';
import { ERC20_ABI } from './abi';
import { mapLimit, withRetry } from './utils/async';
import type { TokenSpec } from './utils/config';
import { sanitizeLabel, shortAddress } from './utils/format';

export interface TokenMeta {
  address: string;
  /** Display label: sanitised, length-capped, never empty. */
  symbol: string;
  decimals: number;
  /** False when symbol() or decimals() could not be read and defaults were used. */
  metadataResolved: boolean;
}

const fallbackSymbol = (spec: TokenSpec): string =>
  sanitizeLabel(spec.symbol ?? shortAddress(spec.address, 6, 4)) || shortAddress(spec.address, 6, 4);

/**
 * Resolve token metadata. Contract-supplied symbols are untrusted text: they are
 * sanitised and capped before ever reaching a terminal or a log file.
 */
export const resolveTokens = async (
  provider: ethers.providers.Provider,
  specs: readonly TokenSpec[],
  concurrency: number
): Promise<TokenMeta[]> => {
  const settled = await mapLimit(specs, concurrency, async (spec) => {
    const contract = new ethers.Contract(spec.address, ERC20_ABI, provider);

    const rawSymbol = await withRetry<unknown>(() => contract.symbol(), { attempts: 2 }).catch(() => undefined);
    const rawDecimals = await withRetry<unknown>(() => contract.decimals(), { attempts: 2 }).catch(() => undefined);

    const decimals = Number(rawDecimals);
    const decimalsValid = rawDecimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36;

    const symbol = (rawSymbol === undefined ? '' : sanitizeLabel(String(rawSymbol))) || fallbackSymbol(spec);

    return {
      address: spec.address,
      symbol,
      decimals: decimalsValid ? decimals : 18,
      metadataResolved: rawSymbol !== undefined && decimalsValid,
    };
  });

  return settled.map((result, index) => {
    if (result.ok) return result.value;
    const spec = specs[index];
    return {
      address: spec.address,
      symbol: fallbackSymbol(spec),
      decimals: 18,
      metadataResolved: false,
    };
  });
};
