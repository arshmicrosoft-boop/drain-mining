#!/usr/bin/env node
import { ethers } from 'ethers';
import { parseArgs, USAGE } from './cli';
import { Monitor } from './monitor';
import { buildPortfolio, renderPortfolio } from './portfolio';
import { deriveAddress } from './wallet';
import { loadConfig } from './utils/config';
import { Logger } from './utils/logger';
import { redactSecrets } from './utils/redact';

const explain = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/could not detect network|missing response|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return `${redactSecrets(message)} (check PROVIDER_URL)`;
  }
  return redactSecrets(message);
};

const main = async (): Promise<number> => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    console.log(USAGE);
    return args.help ? 0 : 1;
  }

  const config = loadConfig({ watchAddresses: args.addresses, tokens: args.tokens });

  if (config.privateKey) {
    const own = deriveAddress(config.privateKey);
    const alreadyWatched = config.watchAddresses.some((address) => address.toLowerCase() === own.toLowerCase());
    if (!alreadyWatched) config.watchAddresses.unshift(own);
  }

  if (config.watchAddresses.length === 0) {
    throw new Error('No addresses to watch. Set WATCH_ADDRESSES in .env, or pass --address 0x...');
  }

  const logger = await Logger.create({ dir: config.logDir, toConsole: args.toConsole });
  const provider = new ethers.providers.JsonRpcProvider(config.providerURL);

  try {
    if (args.command === 'portfolio') {
      const result = await buildPortfolio(config, provider);

      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderPortfolio(result));
        const partial = result.partial ? ' | some readings unreadable (n/a)' : '';
        console.log(
          `block ${result.blockNumber} | ${result.rows.length} address(es) | ${result.columns.length} token(s)${partial}`
        );
      }

      for (const warning of result.warnings) logger.warn(warning);
      logger.info('portfolio rendered', { addresses: result.rows.length, block: result.blockNumber });
      return 0;
    }

    const monitor = new Monitor({ config, provider, logger, once: args.once });
    const onSignal = (signal: string): void => {
      logger.warn(`received ${signal}, finishing current poll (press again to force)`);
      monitor.stop();
    };

    process.once('SIGINT', () => onSignal('SIGINT'));
    process.once('SIGTERM', () => onSignal('SIGTERM'));

    await monitor.run();
    return 0;
  } finally {
    provider.removeAllListeners();
    await logger.close();
  }
};

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(`error: ${explain(error)}`);
    process.exit(1);
  });
