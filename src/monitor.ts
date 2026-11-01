import { ethers } from 'ethers';
import { BalanceChange, BalanceRead, diffSnapshots, fetchBalances, Snapshot } from './balances';
import { BalanceAlert, postAlert } from './notify';
import { resolveTokens, TokenMeta } from './tokens';
import type { AppConfig } from './utils/config';
import { formatAmount, formatSigned, shortAddress } from './utils/format';
import type { Logger } from './utils/logger';
import { redactSecrets } from './utils/redact';

export interface MonitorOptions {
  config: AppConfig;
  provider: ethers.providers.Provider;
  logger: Logger;
  once?: boolean;
}

const MAX_BACKOFF_MS = 5 * 60_000;
const MAX_BACKOFF_STEPS = 5;
const HEARTBEAT_EVERY = 20;

/**
 * Delay before the next poll. Healthy polls target a fixed start-to-start
 * interval; failures double the wait, capped at 5 minutes.
 */
export const nextPollDelay = (intervalMs: number, failures: number, elapsedMs: number): number => {
  if (failures === 0) return Math.max(0, intervalMs - elapsedMs);
  const steps = Math.min(failures, MAX_BACKOFF_STEPS);
  return Math.min(intervalMs * 2 ** steps, MAX_BACKOFF_MS);
};

/**
 * Poll balances, diff against the previous reading, report what moved.
 * Failures back off exponentially instead of killing the loop, and a poll that
 * cannot read a balance is reported (once) rather than treated as a zero.
 */
export class Monitor {
  private readonly config: AppConfig;
  private readonly provider: ethers.providers.Provider;
  private readonly logger: Logger;
  private readonly once: boolean;

  private tokens: TokenMeta[] = [];
  private previous?: Map<string, Snapshot>;
  private failures = 0;
  private polls = 0;
  private stopped = false;
  private unreadable = 0;

  private delayTimer?: NodeJS.Timeout;
  private resolveDelay?: () => void;

  public constructor(options: MonitorOptions) {
    this.config = options.config;
    this.provider = options.provider;
    this.logger = options.logger;
    this.once = options.once ?? false;
  }

  public async run(): Promise<void> {
    const addresses = this.config.watchAddresses;
    if (addresses.length === 0) {
      throw new Error('no addresses to watch: set WATCH_ADDRESSES or pass --address');
    }

    this.tokens = await resolveTokens(this.provider, this.config.tokens, this.config.concurrency);
    this.logger.info(`monitoring ${addresses.length} address(es)`, {
      intervalMs: this.config.pollIntervalMs,
      tokens: this.tokens.map((token) => token.symbol).join(',') || 'none',
    });

    const unresolved = this.tokens.filter((token) => !token.metadataResolved);
    if (unresolved.length > 0) {
      this.logger.warn('token metadata incomplete, using defaults (verify decimals)', {
        tokens: unresolved.map((token) => token.address).join(','),
      });
    }

    while (!this.stopped) {
      const startedAt = Date.now();
      await this.tick();
      this.polls += 1;

      if (this.once || this.stopped) break;

      const delay = nextPollDelay(this.config.pollIntervalMs, this.failures, Date.now() - startedAt);
      if (this.polls % HEARTBEAT_EVERY === 0) {
        this.logger.info('heartbeat', { polls: this.polls, failures: this.failures, nextInMs: delay });
      }
      await this.wait(delay);
    }

    this.logger.info(`stopped after ${this.polls} poll(s)`);
  }

  /** Stop the loop after the in-flight poll completes. */
  public stop(): void {
    this.stopped = true;
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = undefined;
    }
    this.resolveDelay?.();
  }

  private async tick(): Promise<void> {
    try {
      const read = await fetchBalances(
        this.provider,
        this.config.watchAddresses,
        this.tokens,
        this.config.concurrency
      );

      this.reportUnreadable(read);

      if (!this.previous) {
        this.logBaseline(read.snapshots);
      } else {
        const changes = diffSnapshots(this.previous, read.snapshots, this.tokens);
        if (changes.length > 0) await this.report(changes);
      }

      this.previous = read.snapshots;
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`poll failed (${this.failures} consecutive): ${redactSecrets(message)}`);
    }
  }

  /** Warn on the transition into and out of a degraded read state, not every poll. */
  private reportUnreadable(read: BalanceRead): void {
    const tokenFailures = [...read.unreadableTokens.values()].reduce((sum, holders) => sum + holders.length, 0);
    const total = read.unreadableEth.length + tokenFailures;

    if (total === this.unreadable) return;

    if (total === 0) {
      this.logger.info('all balances readable again');
    } else {
      this.logger.warn('some balances could not be read this poll', {
        ethAddresses: read.unreadableEth.length,
        tokenBalances: tokenFailures,
      });
    }
    this.unreadable = total;
  }

  private logBaseline(snapshot: ReadonlyMap<string, Snapshot>): void {
    for (const [, entry] of snapshot) {
      const parts = [`${formatAmount(entry.eth, 18)} ETH`];
      for (const [tokenAddress, balance] of entry.tokens) {
        const meta = this.tokens.find((token) => token.address.toLowerCase() === tokenAddress);
        if (meta) parts.push(`${formatAmount(balance, meta.decimals)} ${meta.symbol}`);
      }
      this.logger.info('baseline', { address: shortAddress(entry.address, 10, 8), balance: parts.join(' | ') });
    }
  }

  private async report(changes: readonly BalanceChange[]): Promise<void> {
    const alerts: BalanceAlert[] = [];

    for (const change of changes) {
      const decimals = change.token?.decimals ?? 18;
      const symbol = change.token?.symbol ?? 'ETH';

      const previous = formatAmount(change.previous, decimals);
      const current = formatAmount(change.current, decimals);
      const delta = formatSigned(change.delta, decimals);
      const direction = change.delta.isNegative() ? '-' : '+';

      this.logger.event(
        `${direction} ${shortAddress(change.address, 10, 8)} ${symbol} ${previous} -> ${current} (${delta})`,
        {
          address: change.address,
          symbol,
          previous,
          current,
          delta,
          ...(change.token ? { token: change.token.address } : {}),
        },
        change.delta.isNegative() ? 'down' : 'up'
      );

      alerts.push({ address: change.address, symbol, previous, current, delta });
    }

    if (this.config.webhookURL) {
      await postAlert(
        this.config.webhookURL,
        {
          timestamp: new Date().toISOString(),
          summary: `${alerts.length} balance change(s) across ${this.config.watchAddresses.length} address(es)`,
          alerts,
        },
        (message) => this.logger.warn(message)
      );
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.resolveDelay = () => {
        this.resolveDelay = undefined;
        resolve();
      };
      this.delayTimer = setTimeout(() => {
        this.delayTimer = undefined;
        this.resolveDelay?.();
      }, ms);
    });
  }
}
