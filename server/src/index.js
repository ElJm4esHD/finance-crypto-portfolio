import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { dailyBackup } from './lib/backup.js';
import { lastRun, scheduleDaily, WEEKDAYS } from './lib/schedule.js';
import { localDate } from './lib/dates.js';
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

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `Datos en ${config.dataDir} · precios cripto: ${cryptoPrices.name} · CEDEARs/ETF: ${marketPrices.name} · dólar: ${fxProvider.name}`,
);

// ── Daily jobs (server local time; America/Argentina/Buenos_Aires in Docker) ──
const JOBS = {
  // Dólar MEP once a day; if DolarAPI fails, retry every 15 minutes.
  mep: { at: '10:30' },
  // Closing value of each portfolio for the growth chart. CEDEARs/ETF at the
  // close of the Argentine market (17:00) plus the delay of the quotes.
  crypto: { at: '23:59' },
  cedears: { at: '17:30', days: WEEKDAYS },
};

let mepRetry = null;
async function refreshMep() {
  clearTimeout(mepRetry);
  if (!(await fx.refresh())) mepRetry = setTimeout(refreshMep, 15 * 60_000);
}

scheduleDaily({ ...JOBS.mep, job: refreshMep, log: app.log });
for (const portfolio of ['crypto', 'cedears']) {
  scheduleDaily({ ...JOBS[portfolio], job: () => snapshots.capture(portfolio), log: app.log });
}

// Catch up on start: a restart (or the server being off) must not lose
// today's MEP or a snapshot whose time already passed.
async function catchUp() {
  const now = new Date();
  if (fx.isOlderThan(lastRun(now, JOBS.mep.at) ?? new Date(0))) await refreshMep();
  for (const portfolio of ['crypto', 'cedears']) {
    const { at, days } = JOBS[portfolio];
    const last = lastRun(now, at, days);
    if (last && localDate(last) === localDate(now) && !snapshots.has(portfolio)) await snapshots.capture(portfolio);
  }
}
setTimeout(catchUp, 3_000);

// One database backup per day (it only writes once a day; checked hourly).
const backup = () => dailyBackup(db, config.dataDir, config.backupKeep, app.log);
setTimeout(backup, 5_000);
const backupTimer = setInterval(backup, 60 * 60_000);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    clearInterval(backupTimer);
    await app.close();
    db.close();
    process.exit(0);
  });
}
