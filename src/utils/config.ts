import * as dotenv from 'dotenv';
import { ethers } from 'ethers';

export interface TokenSpec {
  address: string;
  /** Optional override; resolved from the contract when omitted. */
  symbol?: string;
}

export interface AppConfig {
  providerURL: string;
  watchAddresses: string[];
  privateKey?: string;
  tokens: TokenSpec[];
  pollIntervalMs: number;
  concurrency: number;
  webhookURL?: string;
  logDir: string;
}

export interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  /** Raw address strings from the CLI, already comma-joined or not. */
  watchAddresses?: readonly string[];
  tokens?: string;
}

const SEPARATORS = /[\s,;]+/;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** Parse, validate, checksum and de-duplicate a list of addresses. */
export const parseAddressList = (raw: string, label = 'address'): string[] => {
  const seen = new Set<string>();
  const addresses: string[] = [];

  for (const entry of raw.split(SEPARATORS)) {
    const value = entry.trim();
    if (!value) continue;
    if (!ethers.utils.isAddress(value)) {
      throw new Error(`Invalid ${label}: "${value}" is not a valid 0x-prefixed 40-hex-character address`);
    }
    const checksummed = ethers.utils.getAddress(value);
    const key = checksummed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(checksummed);
  }

  return addresses;
};

/** Parse `SYMBOL:0xabc…` or bare `0xabc…` token entries. */
export const parseTokens = (raw: string): TokenSpec[] => {
  const seen = new Set<string>();
  const tokens: TokenSpec[] = [];

  for (const entry of raw.split(SEPARATORS)) {
    const value = entry.trim();
    if (!value) continue;

    const separator = value.indexOf(':');
    const symbol = separator > 0 ? value.slice(0, separator).trim() : undefined;
    const address = separator > 0 ? value.slice(separator + 1).trim() : value;

    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid token entry: "${value}" does not contain a valid 0x address`);
    }

    const checksummed = ethers.utils.getAddress(address);
    const key = checksummed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    tokens.push(symbol ? { address: checksummed, symbol } : { address: checksummed });
  }

  return tokens;
};

const readInteger = (name: string, raw: string | undefined, fallback: number, min: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  }
  return value;
};

const readURL = (name: string, raw: string | undefined, protocols: readonly string[]): string => {
  const value = (raw ?? '').trim();
  if (!value) throw new Error(`${name} is not set. Copy .envexample to .env and fill it in.`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Deliberately does not echo the value: it may contain an API key.
    throw new Error(`${name} is not a valid URL`);
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(' or ')} — got ${parsed.protocol}`);
  }
  return value;
};

/**
 * Resolve configuration from the environment. Missing .env is not fatal (CI and
 * shell-exported variables are valid sources); missing *values* are.
 */
export const loadConfig = (options: LoadOptions = {}): AppConfig => {
  if (!options.env) {
    dotenv.config({ path: '.env' });
  }
  const env = options.env ?? process.env;

  const providerURL = readURL('PROVIDER_URL', env.PROVIDER_URL, ['https:', 'http:', 'wss:', 'ws:']);

  const rawWatch = options.watchAddresses?.length
    ? options.watchAddresses.join(',')
    : (env.WATCH_ADDRESSES ?? '');
  const watchAddresses = parseAddressList(rawWatch, 'watch address');

  const privateKey = (env.PRIVATE_KEY ?? '').trim();
  if (privateKey && !PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error('PRIVATE_KEY must be a 0x-prefixed 64-hex-character key');
  }

  const webhookURL = (env.WEBHOOK_URL ?? '').trim();

  return {
    providerURL,
    watchAddresses,
    privateKey: privateKey || undefined,
    tokens: parseTokens(options.tokens ?? env.TOKENS ?? ''),
    pollIntervalMs: readInteger('POLL_INTERVAL_MS', env.POLL_INTERVAL_MS, 15_000, 1_000),
    concurrency: readInteger('CONCURRENCY', env.CONCURRENCY, 8, 1),
    webhookURL: webhookURL ? readURL('WEBHOOK_URL', webhookURL, ['https:', 'http:']) : undefined,
    logDir: (env.LOG_DIR ?? './logs').trim() || './logs',
  };
};
