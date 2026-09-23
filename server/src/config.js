import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  // Price providers: "mock" until the real integrations are wired (see src/prices/).
  cryptoPriceProvider: env.CRYPTO_PRICE_PROVIDER ?? 'mock',
  marketPriceProvider: env.MARKET_PRICE_PROVIDER ?? 'mock',
  // How often the snapshot job refreshes today's snapshot (minutes).
  snapshotIntervalMinutes: Number(env.SNAPSHOT_INTERVAL_MINUTES ?? 60),
  backupKeep: Number(env.BACKUP_KEEP ?? 14),
};
