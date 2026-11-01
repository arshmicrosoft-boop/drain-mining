# Contributing

Thanks for looking. This is a small project and the bar is mostly "does it hold up under
scrutiny", not "does it add features".

## Getting set up

```bash
git clone https://github.com/arshmicrosoft-boop/drain-mining.git
cd drain-mining
npm install
npm run typecheck
npm test
```

No `.env` is needed for the test suite — every RPC call in the tests goes through a stub
provider. If you want to run against a real chain, copy `.envexample` to `.env` and fill
in an endpoint (the README's quick start covers this).

## Before you open a PR

```bash
npm run typecheck   # must be clean
npm test            # must be green
```

Both run in CI on Node 18, 20 and 22. A PR that fails CI will not be reviewed.

## What makes a change easy to accept

- **Tests first.** Every behavioural fix needs a test that fails without it. The failure
  paths in `src/balances.ts` are the reason this project exists; they are covered with
  fault injection, and new ones should be too.
- **No new dependencies** unless the standard library genuinely cannot do the job. The
  dependency list is `ethers` and `dotenv`, and it should stay that way.
- **Small, focused commits.** One idea per commit, imperative subject under 72 characters.
- **Match the existing style.** Two-space indent, single quotes, `const` arrows for
  functions, no default exports. There is no linter — the review is the linter.
- **Read `DESIGN.md` first** if you are touching balance reads or the diff. The
  "never invent a reading" rule is load-bearing: a failed read must never become a zero,
  because a zero fires a false drain alert.

## What will be declined

- Anything that makes the tool able to sign or send transactions. It is read-only on
  purpose.
- Requesting, storing, or transmitting private keys or seed phrases anywhere new.
- Rewriting working modules for style alone.
- Performance work that is not measured. If you claim a speed-up, show the numbers.

## Reporting bugs

Open an issue with the exact command, the output you got, and what you expected. Redact
your RPC URL — it usually contains your API key. Security issues go through
`SECURITY.md`, not the issue tracker.

## Commits and licensing

By contributing you agree your work is licensed under the MIT licence in `LICENSE`.
