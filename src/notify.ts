export interface BalanceAlert {
  address: string;
  symbol: string;
  previous: string;
  current: string;
  delta: string;
}

export interface AlertPayload {
  timestamp: string;
  summary: string;
  alerts: BalanceAlert[];
}

type FetchLike = (input: string, init: unknown) => Promise<{ ok: boolean; status: number }>;

/**
 * POST an alert to a webhook. Failures are swallowed on purpose: a broken
 * webhook must never take down the monitor loop.
 */
export const postAlert = async (
  url: string,
  payload: AlertPayload,
  onError?: (message: string) => void
): Promise<void> => {
  const doFetch = (globalThis as unknown as { fetch?: FetchLike }).fetch;
  if (typeof doFetch !== 'function') {
    onError?.('global fetch is unavailable; run on Node 18 or newer');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) onError?.(`webhook responded with HTTP ${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError?.(`webhook request failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
};
