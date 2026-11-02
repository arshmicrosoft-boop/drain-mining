export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Run `fn` over `items` with at most `limit` promises in flight at any time.
 * Results keep input order. Errors are captured per item instead of aborting
 * the whole batch, so one bad address cannot kill a poll.
 */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<Settled<R>>> => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`concurrency limit must be an integer >= 1, got ${limit}`);
  }

  const results: Array<Settled<R>> = new Array(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
};

export interface RetryOptions {
  attempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/** Exponential backoff with jitter. Throws the last error once attempts run out. */
export const withRetry = async <T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> => {
  const attempts = Math.max(1, Math.floor(options.attempts));
  const baseDelay = options.baseDelayMs ?? 250;
  const maxDelay = options.maxDelayMs ?? 8_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const backoff = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const jittered = Math.round(backoff * (0.5 + Math.random() * 0.5));
      options.onRetry?.(error, attempt, jittered);
      await sleep(jittered);
    }
  }
  throw lastError;
};
