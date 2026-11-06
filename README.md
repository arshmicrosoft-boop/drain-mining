# draino

[![CI](https://github.com/arshmicrosoft-boop/drain-mining/actions/workflows/ci.yml/badge.svg)](https://github.com/arshmicrosoft-boop/drain-mining/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Ethereum wallet monitor and portfolio CLI.

Two commands:

- **`monitor`** — poll a set of addresses, diff each poll against the last, and report
  exactly what moved. Logs to disk, optionally POSTs a webhook.
- **`portfolio`** — one-shot table of ETH and ERC-20 balances across a list of addresses.

> **Read-only by design.** `draino` never signs or sends a transaction, and it never needs
> a seed phrase or private key. It asks your RPC provider for public balances and prints
> them. Watch addresses you own, or any address — balances are public data either way.
>
> Watching 50 addresses across 4 assets costs **3 RPC requests per poll**, not 200.

## Quick start

### 1. Install

Requires Node 18 or newer (`node --version`).

```bash
npm install
```

### 2. Get an RPC endpoint

Every read goes through one JSON-RPC URL. Any of these work:

| Provider | Free tier | Notes |
| --- | --- | --- |
| **Alchemy** — recommended | 30M compute units/month, 15 req/s | WebSockets, request logs, usage dashboard. Create an app named `draino-watch` so you can revoke the key independently. |
| Infura | 3M credits/day | Fine, smaller daily quota, one key. |
| publicnode | unlimited, rate-limited | No signup, no key. Good for a first run. |
| QuickNode | 1-month trial only | Not a lasting free tier. |
| Ankr | key required | Key-gated; skip. |

15-second polling is one batched call per poll, so even the smallest tier is far more than enough.

### 3. Create `.env`

```bash
cp .envexample .env        # Windows: copy .envexample .env
```

Open `.env` and fill in the two required values:

```dotenv
PROVIDER_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
WATCH_ADDRESSES=0xYourAddress
```

`.envexample` documents every other setting with examples, including verified
mainnet token addresses. `.env` is gitignored — never commit it.

### 4. Verify

```bash
npm run dev -- portfolio
```

Working output looks like this:

```
address                   ETH       USDC       USDT
-------------------  --------  ---------  ---------
0xd8dA6BF2...7aA96045  5.779567  39.192124  291.36822
total                  5.779567  39.192124  291.36822
block 26317290 | 1 address(es) | 2 token(s)
```

Then a single monitor poll, which prints a baseline and exits:

```bash
npm run dev -- monitor --once
```

### 5. Run it

```bash
npm run monitor        # polls until Ctrl-C
```

Logs land in `logs/YYYY-MM-DD.log` and `logs/YYYY-MM-DD.events.jsonl`.

### Where to get the values

- **Addresses** — the public `0x…` string from the "Receive" screen of MetaMask,
  Rabby, Ledger, etc. Read-only; a seed phrase is never needed and should never
  be pasted anywhere.
- **Tokens** — verified mainnet contracts are listed in `.envexample`
  (USDC, USDT, DAI, WETH). The `SYMBOL:` prefix is optional; symbols are read
  from the contract when it exposes `symbol()`.
- **Alerts** — a free [ntfy](https://ntfy.sh) topic works with no account:
  set `WEBHOOK_URL=https://ntfy.sh/<long-random-topic>`. Discord and Slack
  webhooks expect a different payload shape and will reject it.

## Troubleshooting

| Message | Cause | Fix |
| --- | --- | --- |
| `PROVIDER_URL is not set` | No `.env`, or running outside the repo root | Create `.env` next to `package.json`; values must be `KEY=value` with no quotes |
| `could not detect network (check PROVIDER_URL)` | Dead endpoint, wrong chain path, or a retired network | Test the URL with `curl`; retired testnets like Kovan and Ropsten no longer respond |
| `401` / `Unauthorized` | Bad or revoked API key | Regenerate in the provider dashboard |
| `429` / rate limit | Polling faster than your tier allows | Raise `POLL_INTERVAL_MS`, lower `CONCURRENCY` |
| `multicall3 returned no data` | Chain without a multicall3 deployment | Automatic fallback to individual reads; slower but works |
| `n/a` in the portfolio table | That read failed this poll | Not a zero balance — the row is left unread rather than invented |
| `metadata ... could not be read; assuming 18 decimals` | Token does not expose `decimals()` | Amounts may be off by a power of ten; verify the contract |


## Commands

```bash
npm run portfolio              # one-shot balance table
npm run monitor                # poll every POLL_INTERVAL_MS until Ctrl-C
npm run dev -- monitor --once  # single poll, then exit
npm run build                  # compile to bin/, then `npm start`
```

Options can also be given on the command line, which overrides `.env`:

```bash
npx ts-node src/index.ts portfolio --address 0xd8dA...,0x0000... --json
npx ts-node src/index.ts monitor --tokens USDC:0xA0b8... --once
```

Project uses **npm** (the previous `yarn.lock` came from a yarn install that is not
present on this machine, so the repo is npm-only now).

```
address                   ETH       USDC
-------------------  --------  ---------
0xd8dA6BF2...7aA96045  5.779567  39.192124
total                  5.779567  39.192124
block 26317290 | 1 address(es) | 2 token(s)
```

## How it works

```
src/
  index.ts       wiring, signal handling
  cli.ts         argument parsing + usage text
  monitor.ts     poll loop, change reporting, backoff
  portfolio.ts   one-shot table/JSON builder
  balances.ts    batched RPC reads, unreadable tracking, pure diffing
  tokens.ts      token metadata resolution + label sanitising
  abi.ts         minimal Multicall3 and ERC-20 ABIs
  notify.ts      optional webhook delivery
  wallet.ts      private key -> address (offline)
  utils/
    config.ts    env parsing and validation
    logger.ts    non-blocking file logger + JSONL event stream
    format.ts    amount formatting, table rendering, ANSI helpers
    async.ts     concurrency limiter, retry with backoff
    redact.ts    strips API keys from error and log output
```

**Reads are batched.** ETH and token balances are planned as one flat call list and
executed through a single Multicall3 pipeline, chunked at 100 calls per request and
bounded by `CONCURRENCY`. Watching 50 addresses for ETH plus 3 tokens costs 4 RPC calls
per poll instead of 200. If multicall3 is not deployed, the client detects it and falls
back to individual calls with retry.

**Failures are never invented.** A read that fails is omitted and reported as `n/a`, never
coerced to zero — for ETH as well as tokens. `balances.ts:fetchBalances` returns the
snapshots it could actually read plus `unreadableEth` / `unreadableTokens`, and
`diffSnapshots` only compares readings present in both polls. The monitor warns once when
it enters or leaves a degraded state instead of every poll.

**Provider errors are not amplified.** Only a genuine "multicall unavailable" failure
triggers the per-address fallback. Auth errors, timeouts and rate limits are rethrown
immediately, so one failed call never becomes 3xN retries.

**Logs never block.** Writes go to buffered `WriteStream`s, not `appendFileSync`, and the
streams roll over to a new file when the UTC date changes — a monitor running for weeks
keeps writing to the correct day. Colour is applied to the console copy only; log records
stay plain ASCII.

**Failures back off.** Consecutive poll failures double the delay up to 5 minutes, and
the loop keeps running. A poll that cannot read the chain is skipped rather than
recorded as a change.

The reasoning behind these choices, and the defects that motivated each one, is in
[`DESIGN.md`](DESIGN.md).

## Output files

`logs/YYYY-MM-DD.log` — newline-delimited JSON records (`info`, `warn`, `error`).

`logs/YYYY-MM-DD.events.jsonl` — one record per detected balance change:

```json
{"time":"2026-11-01T03:41:22.858Z","level":"event","message":"+ 0xd8dA6BF2...7aA96045 ETH 1 -> 1.5 (+0.5)","data":{"address":"0xd8dA...","symbol":"ETH","previous":"1","current":"1.5","delta":"+0.5"}}
```

```bash
npm run logs:clear    # delete the logs directory
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PROVIDER_URL` | required | JSON-RPC endpoint (`http(s)` or `ws(s)`) |
| `WATCH_ADDRESSES` | — | comma-separated addresses |
| `PRIVATE_KEY` | — | optional; derived address is prepended to the watch list |
| `TOKENS` | — | `SYMBOL:0xaddr` or `0xaddr` |
| `POLL_INTERVAL_MS` | `15000` | monitor poll interval (min 1000) |
| `CONCURRENCY` | `8` | parallel RPC requests (min 1) |
| `WEBHOOK_URL` | — | POST target for balance alerts |
| `LOG_DIR` | `./logs` | log directory |

Addresses are validated with `ethers.utils.isAddress` and stored checksummed; duplicates
are dropped. Bad input fails loudly at startup instead of sending funds into the void.
Token symbols come from arbitrary contracts, so they are sanitised (control characters
stripped, width capped) before reaching a terminal or a log file, and columns are keyed by
token address so two tokens sharing a symbol cannot collide.

## Tests

```bash
npm test        # tsc, then node --test over the compiled suite
npm run typecheck
```

59 tests covering formatting, table layout, config validation, CLI parsing, concurrency
limiting, retry/backoff, snapshot diffing, token symbol sanitising, key redaction, and the
failure paths: a failed ETH read, empty return data, an unavailable multicall, and a
provider error that must not be retried per address. No network access is required — every
RPC call goes through a stub provider that returns real ABI-encoded responses.

## Security notes

- `.env` is gitignored. `.envexample` ships with empty values — never put a real key in it.
- Do not paste your RPC URL into an issue or a screenshot; it usually contains your API key.
  Config errors and logs run through `utils/redact.ts` so key material is not echoed.
- Private keys are never logged. `PRIVATE_KEY` is optional and used offline to derive an
  address; `--address 0x...` does the same without putting signing material on disk.
- A webhook payload contains addresses and balances. Point it at something you control.
- Report vulnerabilities through the Security tab, not the issue tracker. See `SECURITY.md`.

## Contributing

Tests and typecheck first, no new dependencies, and the tool stays read-only. The full
rules are in `CONTRIBUTING.md`; `DESIGN.md` explains which decisions are load-bearing
before you touch the read pipeline.

## License

MIT — see [LICENSE](LICENSE).
