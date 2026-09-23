import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { dailyBackup } from './lib/backup.js';
import { getCryptoPriceProvider, getFxProvider, getMarketPriceProvider } from './prices/index.js';
import { createFxService } from './prices/fx.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const db = openDb(path.join(config.dataDir, 'portfolio.db'));
const cryptoPrices = getCryptoPriceProvider();
const marketPrices = getMarketPriceProvider();
const fxProvider = getFxProvider();
// Logs through Fastify's logger (only used after the app is built).
const fx = createFxService({ db, provider: fxProvider, log: { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) } });

const { app, snapshots } = buildApp({
  db,
  cryptoPrices,
  marketPrices,
  fx,
  publicDir: path.resolve(here, '../public'),
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

// Daily job: refreshes today's snapshot of both portfolios on a fixed interval
// (the last run of the day becomes that day's closing value) and keeps one
// database backup per day. Running hourly makes it resilient to restarts.
async function dailyJob() {
  await snapshots.captureAll();
  await dailyBackup(db, config.dataDir, config.backupKeep, app.log);
}

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `Datos en ${config.dataDir} · precios cripto: ${cryptoPrices.name} · CEDEARs/ETF: ${marketPrices.name} · dólar: ${fxProvider.name}`,
);

setTimeout(() => fx.refresh(), 3_000);
setTimeout(dailyJob, 5_000);
const timer = setInterval(dailyJob, 60 * 60_000);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    clearInterval(timer);
    await app.close();
    db.close();
    process.exit(0);
  });
}
