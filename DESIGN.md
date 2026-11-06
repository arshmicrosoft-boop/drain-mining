# Design

Why the code is shaped this way, and which decisions are load-bearing. Read this before
changing anything in `src/balances.ts` or `src/monitor.ts`.

## Scope

`draino` answers two questions: *what do these addresses hold right now* (`portfolio`) and
*what changed since the last poll* (`monitor`). Both are pure reads. There is no signing
path, no transaction construction, and no key material required.

## Module map

| Module | Responsibility |
| --- | --- |
| `index.ts` | wiring, signal handling, exit codes |
| `cli.ts` | argument parsing and usage text (pure, directly testable) |
| `monitor.ts` | poll loop, change reporting, backoff |
| `portfolio.ts` | one-shot table/JSON builder |
| `balances.ts` | batched RPC reads, unreadable tracking, pure diffing |
| `tokens.ts` | ERC-20 metadata resolution, label sanitising |
| `abi.ts` | minimal Multicall3 and ERC-20 ABIs |
| `notify.ts` | optional webhook delivery |
| `wallet.ts` | private key → address, offline |
| `utils/` | config, logger, formatting, concurrency, redaction |

`balances.ts` owns the read pipeline and the diff. `monitor.ts` owns scheduling and
reporting. Neither knows about the other's internals, which is what makes the diff
testable without a loop and the loop testable without a chain.

## The read pipeline

Every poll needs `1 + tokens` values per address. Doing that naively is one RPC round-trip
per value: 50 addresses × 4 assets = 200 requests, which is both slow and a rate-limit
magnet on a free tier.

Instead, all reads are planned as one flat list of calls and executed through Multicall3's
`aggregate3`, in chunks of 100 calls per request:

```
plan:   eth(addr[0]) … eth(addr[n]) | balanceOf(token, addr[0]) … balanceOf(token, addr[n])
run:    aggregate3(chunk) × ceil(calls / 100), bounded by CONCURRENCY
```

50 addresses × 4 assets becomes 3 requests instead of 200. The same plan is used for the
ETH and token paths, so there is exactly one place where "this read failed" is decided.

`aggregate3` is used rather than `aggregate` because each sub-call carries its own
`allowFailure` flag: one reverting token contract cannot poison the whole batch.

## Failure semantics

This is the rule the project is built around, and the reason it exists in its current form.

> **A read that fails is never a zero.**

A zero balance is indistinguishable from a real drain. If a provider hiccups and returns
nothing, and that gets coerced to `0`, the monitor fires a false "your wallet is empty"
alert. False alarms are worse than no alarms, because they train the operator to ignore
the real one.

So:

1. `fetchBalances` returns the snapshots it could **actually** read, plus explicit
   `unreadableEth` and `unreadableTokens` lists.
2. `diffSnapshots` compares only readings present in **both** polls. A missing reading is
   skipped, not treated as a drop to zero.
3. If *no* ETH balance could be read, the poll throws and backs off rather than reporting
   a total outage as a set of changes.
4. The UI shows `n/a`, and the monitor warns once when it enters a degraded state and once
   when it leaves — not on every poll.

Three corollaries that are easy to regress:

- `success: true` with empty return data is a *failed* parse, not zero (`parseUint`
  returns `undefined`).
- A token read that fails is absent from the snapshot, which means the diff silently skips
  it. That silence is reported by the degraded-state transition.
- `formatAmount` must never render a non-zero value as `0`; it emits `<0.000001` instead.
  Sub-unit movement on a high-decimals token is still movement.

## Provider errors are not amplified

The per-address fallback exists for exactly one situation: the chain does not have a
Multicall3 deployment, so `aggregate3` cannot work. `isMulticallUnavailable` gates it on a
narrow set of messages (revert, invalid opcode, no data).

Auth errors, timeouts and rate limits are rethrown immediately. Without that gate, one
provider outage on 50 addresses would become 150 retried single calls against the same
failing endpoint — turning a small problem into a bigger one.

## Backoff

Consecutive failures double the delay, capped at 5 minutes:

```
delay = min(interval × 2^failures, 5 min)
```

Healthy polls target a fixed *start-to-start* interval, so a slow poll does not stack the
next delay on top of itself. State is never mutated on a failed poll, so the diff baseline
stays at the last good reading.

## Concurrency

`mapLimit` bounds parallelism rather than `Promise.all`, and retries use jittered
exponential backoff. Both exist because free-tier providers rate-limit by request, and
unbounded fan-out turns that into a retry storm.

The limiter is injectable, which is why the tests can drive it deterministically.

## Logging

Writes go to buffered `WriteStream`s rather than `appendFileSync`: a synchronous write per
record becomes the throughput floor of the poll loop. Two files per day:

- `YYYY-MM-DD.log` — JSONL `info` / `warn` / `error`
- `YYYY-MM-DD.events.jsonl` — one record per detected change

Streams are re-opened when the UTC date changes, so a monitor running for weeks keeps
writing to the correct day instead of its boot day. Colour is applied to the console copy
only; log records stay plain ASCII so the JSONL is machine-readable.

Token symbols come from arbitrary contracts. They are stripped of control characters and
capped at 12 characters before reaching a terminal or a file, because a symbol containing
`\u001b[` is a terminal escape, not a name. Portfolio columns are keyed by token address,
not symbol, so two contracts reporting the same symbol cannot overwrite each other.

## Redaction

Provider URLs carry API keys in the path (`/v2/<key>`) or query string, and `ethers`
includes request URLs in some errors. `utils/redact.ts` strips long path segments, named
secret parameters, and basic-auth userinfo before anything is printed or logged. Config
parse failures deliberately do not echo the offending value.

## Defects found in review

Ten problems found by reviewing this implementation. Each has a regression test that fails
without its fix.

| # | Defect | Fix |
| --- | --- | --- |
| 1 | A failed ETH sub-call was recorded as **zero**, firing a false drain alert. The "never invent a reading" rule had only been applied to tokens. | Failed ETH reads are omitted and listed in `unreadableEth`; `diffSnapshots` skips them. If no ETH read succeeds, the poll throws. |
| 2 | `success: true` with empty return data was parsed into zero. | `parseUint` returns `undefined`. |
| 3 | Colour markers were built into the message string, so JSONL carried raw ANSI when stdout was a TTY. | Tone is a separate argument applied to the console copy only. |
| 4 | The log filename date was captured once at process start. | Streams re-open on UTC date change. |
| 5 | Token read failures were silent: omitted, skipped, never logged. | `unreadableTokens` reported; one warning per state transition. |
| 6 | Sub-unit deltas rendered as `+0.000000`. | `<0.000001` for non-zero truncated values; `formatSigned(0)` is `0`. |
| 7 | Portfolio cells keyed by symbol collided; untrusted `symbol()` reached the terminal unsanitised. | Keyed by address, unique labels, control characters stripped. |
| 8 | A bare `catch` turned any provider error into 3×N per-address retries. | `isMulticallUnavailable` gates the fallback. |
| 9 | `decimals()` failure silently assumed 18, misreporting by up to 10^12. | `metadataResolved` is surfaced and warned about. |
| 10 | Token reads fanned out via `Promise.all`, outside the concurrency limit. | One flat call list through one bounded pipeline. |

## Testing strategy

No network in the suite. `ethers.Contract` talks to a provider object, so the tests pass a
stub that decodes real call data and returns real ABI-encoded responses. That means the
tests exercise the actual encoding paths, not a mock of our own wrapper.

Covered failure paths: a failed sub-call, `success: true` with empty data, a genuinely
zero balance (must survive as zero), unavailable multicall (must fall back), and a
provider error (must *not* fall back).

## Known limitations

These are deliberate scope choices, not oversights.

- **Polling, not subscriptions.** A 15-second poll costs one batched call, which is cheap,
  but detection latency is up to one interval. `eth_subscribe` over WebSocket is the
  obvious next step and is why `.envexample` accepts `ws(s)://` URLs already.
- **No persistence.** A restart re-baselines, so a change that happens while the process is
  down is not reported. State is in memory by design; a JSON state file is the natural
  increment.
- **No chain configuration.** Multicall3's address is hardcoded to the canonical
  deployment, which exists on most EVM chains but not all. Non-canonical chains fall back
  to individual reads.
- **No reorg handling.** Polls compare raw balances; a reorg between polls shows up as an
  ordinary change.
- **Token metadata is re-resolved on every start** — two `eth_call`s per token, cached
  nowhere.
