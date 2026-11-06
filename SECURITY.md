# Security policy

## Scope

`draino` is a **read-only** client. It calls `eth_call`, `eth_getBalance` and
`eth_blockNumber` through your RPC provider and prints a table. It does not construct,
sign, or broadcast transactions.

What it *does* touch that matters:

| Data | Where it lives | Risk |
| --- | --- | --- |
| `PROVIDER_URL` | `.env`, sent to your provider | Anyone with it can spend your provider quota |
| `PRIVATE_KEY` (optional) | `.env`, used offline to derive an address | Anyone with it can spend that wallet's funds — see below |
| `WATCH_ADDRESSES` | `.env`, sent to your provider | Public on-chain data; also sent to any webhook you configure |
| `WEBHOOK_URL` | `.env` | The target sees your addresses and balances on every change |

`.env` is gitignored. `.envexample` is committed and must never contain a real key.

### On `PRIVATE_KEY`

It is optional and this tool does not need it. It exists only so the address you own is
added to the watch list automatically. If you need that, prefer passing
`--address 0x...` instead: it does the same thing without putting signing material on
disk. If you do set it, treat the file as equivalent to the wallet itself.

## Supported versions

Only the latest release on `main` receives fixes. This is a single-maintainer project
with no LTS branches.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private reporting: go to the repository's **Security** tab →
**Report a vulnerability**. That opens a draft advisory only you and the maintainer can
see.

Please include the version or commit, a description of the impact, and a minimal
reproduction. Expect an acknowledgement within 7 days; if the issue is confirmed you will
be credited in the advisory unless you ask otherwise.

## Out of scope

- **Exposure of your own API key.** If you paste a key into `.envexample`, a commit, an
  issue, or a screenshot, rotate it in your provider's dashboard. The maintainer cannot
  revoke keys it does not own.
- **Third-party providers.** Rate limits, outages, and data accuracy are the provider's
  responsibility, not this client's.
- **Balances displayed for an address you do not control.** Everything here is public
  chain data. Reading it is not a vulnerability.
- **`n/a` cells.** An unreadable balance is deliberately not a zero, so it never fires a
  false "drained" alert. See `DESIGN.md`.
