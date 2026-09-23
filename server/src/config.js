import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  // Price providers (see src/prices/). "mock" = made-up prices, no internet.
  cryptoPriceProvider: env.CRYPTO_PRICE_PROVIDER ?? 'binance',
  marketPriceProvider: env.MARKET_PRICE_PROVIDER ?? 'yahoo',
  fxProvider: env.FX_PROVIDER ?? 'dolarapi',
  backupKeep: Number(env.BACKUP_KEEP ?? 14),
};
