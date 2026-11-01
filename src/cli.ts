export type Command = 'monitor' | 'portfolio';

export interface ParsedArgs {
  command?: Command;
  addresses: string[];
  tokens?: string;
  once: boolean;
  json: boolean;
  help: boolean;
  toConsole: boolean;
}

export const USAGE = `draino - Ethereum wallet monitor and portfolio CLI

Usage:
  draino monitor    [options]   watch addresses and report balance changes
  draino portfolio  [options]   print a one-shot balance table

Options:
  --address <list>   comma-separated addresses (overrides WATCH_ADDRESSES)
  --tokens <list>    comma-separated tokens as SYMBOL:0xaddress or 0xaddress
  --once             monitor: run a single poll, then exit
  --json             portfolio: emit JSON instead of a table
  --quiet            suppress console output (log files only)
  -h, --help         show this help

Environment (.env - see .envexample):
  PROVIDER_URL       required JSON-RPC endpoint
  WATCH_ADDRESSES    comma-separated addresses to watch
  PRIVATE_KEY        optional; its address is added to the watch list
  TOKENS             optional comma-separated token contracts
  POLL_INTERVAL_MS   monitor poll interval (default 15000)
  CONCURRENCY        parallel RPC requests (default 8)
  WEBHOOK_URL        optional POST target for balance alerts
  LOG_DIR            log directory (default ./logs)`;

const ADDRESS_SEPARATORS = /[\s,;]+/;

/** Parse argv into a command plus options. Throws on anything unrecognised. */
export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const parsed: ParsedArgs = {
    addresses: [],
    once: false,
    json: false,
    help: false,
    toConsole: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case 'monitor':
      case 'portfolio':
        parsed.command = argument;
        break;
      case '--address': {
        const value = argv[index + 1];
        if (!value) throw new Error('--address requires a value');
        parsed.addresses.push(...value.split(ADDRESS_SEPARATORS).filter(Boolean));
        index += 1;
        break;
      }
      case '--tokens': {
        const value = argv[index + 1];
        if (!value) throw new Error('--tokens requires a value');
        parsed.tokens = value;
        index += 1;
        break;
      }
      case '--once':
        parsed.once = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--quiet':
        parsed.toConsole = false;
        break;
      case '-h':
      case '--help':
        parsed.help = true;
        break;
      default:
        if (argument.startsWith('-')) throw new Error(`unknown option: ${argument}`);
        throw new Error(`unknown command: ${argument}`);
    }
  }

  return parsed;
};
