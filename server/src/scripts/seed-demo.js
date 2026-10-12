// Loads demo data (holdings, exchanges, operations and ~14 months of daily
// snapshots) so the app can be shown end-to-end.
//
//   DATA_DIR=./demo-data npm run seed:demo
//
// Refuses to run on a database that already has data, unless --force.
import path from 'node:path';
import { config } from '../config.js';
import { openDb } from '../db.js';
import { localDate } from '../lib/dates.js';
import { createCryptoService } from '../crypto/service.js';
import { createCedearService } from '../cedears/service.js';
import { createSnapshotService } from '../snapshots/service.js';
import { mockCryptoProvider } from '../prices/mock-crypto.js';
import { mockMarketProvider } from '../prices/mock-market.js';

const file = path.join(config.dataDir, 'portfolio.db');
const db = openDb(file);

const hasData = ['crypto_holdings', 'crypto_exchanges', 'cedear_operations', 'cedear_cash_movements', 'snapshots'].some(
  (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n > 0,
);
if (hasData && !process.argv.includes('--force')) {
  console.error(`La base ${file} ya tiene datos. No se cargó nada (usá --force para cargar igual).`);
  process.exit(1);
}

const crypto = createCryptoService(db, mockCryptoProvider);
const cedears = createCedearService(db, mockMarketProvider);
const snapshots = createSnapshotService(db, { crypto, cedears });

// ── Cripto ───────────────────────────────────────────────
crypto.setHolding('USDT', 4200);
crypto.setHolding('BTC', 0.045);
crypto.setHolding('ETH', 0.9);
crypto.createExchange({ executedAt: '2026-08-02T11:20', fromAsset: 'USDT', fromAmount: 1000, toAsset: 'SOL', toAmount: 5.6, feeAsset: 'USDT', feeAmount: 1 });
crypto.createExchange({ executedAt: '2026-08-19T18:05', fromAsset: 'ETH', fromAmount: 0.2, toAsset: 'BTC', toAmount: 0.0071 });
crypto.createExchange({ executedAt: '2026-09-10T09:40', fromAsset: 'USDT', fromAmount: 600, toAsset: 'BNB', toAmount: 0.97, feeAsset: 'BNB', feeAmount: 0.00073 });
crypto.setGoal(15000);
// Money put in later (counts as invested, flagged on the growth chart).
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
};
await crypto.createFlow({ type: 'deposit', asset: 'USDT', amount: 1500, executedAt: `${daysAgo(200)}T10:00` });
await crypto.createFlow({ type: 'deposit', asset: 'BTC', amount: 0.01, executedAt: `${daysAgo(45)}T18:30` });

// ── CEDEARs / ETF ────────────────────────────────────────
cedears.createCashMovement({ type: 'deposit', currency: 'ARS', amount: 3500000, date: '2026-06-01', note: 'Transferencia inicial' });
cedears.createCashMovement({ type: 'deposit', currency: 'USD', amount: 4000, date: '2026-06-01' });
cedears.createCashMovement({ type: 'deposit', currency: 'ARS', amount: 800000, date: daysAgo(30), note: 'Aguinaldo' });
const ops = [
  ['buy', 'AAPL.BA', 40, 18500, 'ARS', 1100, '2026-06-03'],
  ['buy', 'MELI.BA', 20, 21000, 'ARS', 630, '2026-06-10'],
  ['buy', 'SPY', 4, 560, 'USD', 2.5, '2026-06-12'],
  ['buy', 'AAPL.BA', 20, 20100, 'ARS', 600, '2026-07-15'],
  ['buy', 'QQQ', 3, 480, 'USD', 2, '2026-07-20'],
  ['sell', 'QQQ', 3, 505, 'USD', 2, '2026-08-25'],
  ['buy', 'KO.BA', 30, 15800, 'ARS', 710, '2026-09-01'],
];
for (const [type, ticker, quantity, price, currency, commission, date] of ops) {
  cedears.createOperation({ type, ticker, quantity, price, currency, commission, date });
}

// ── Snapshots: a random walk that ends at today's real value ──
// Walking back, the money put in on a day is taken out, so deposits show up
// as jumps. Returns the first value.
function backfill(portfolio, endValue, days, currency, drift, flows = []) {
  const insert = db.prepare('INSERT OR REPLACE INTO snapshots (portfolio, date, value, currency) VALUES (?, ?, ?, ?)');
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dates = Array.from({ length: days }, (_, i) => daysAgo(days - 1 - i));
  const flowOn = new Map();
  for (const f of flows) flowOn.set(f.date, (flowOn.get(f.date) ?? 0) + f.amount);
  const values = Array(days);
  values[days - 1] = endValue;
  for (let i = days - 1; i > 0; i--) values[i - 1] = (values[i] - (flowOn.get(dates[i]) ?? 0)) / (1 + drift + (rand() - 0.5) * 0.04);
  values.forEach((v, i) => insert.run(portfolio, dates[i], Math.round(v * 100) / 100, currency));
  return values[0];
}

const cryptoFlows = crypto.listFlows().map((f) => ({ date: f.executed_at.slice(0, 10), amount: f.value_usdt }));
for (const { value, currency } of await crypto.snapshotValues()) {
  crypto.setOpening(Math.round(backfill('crypto', value, 430, currency, 0.0012, cryptoFlows) * 100) / 100);
}
const movements = cedears.listCashMovements();
for (const { value, currency } of await cedears.snapshotValues()) {
  const flows = movements.filter((m) => m.currency === currency).map((m) => ({ date: m.date, amount: m.amount }));
  backfill('cedears', value, 115, currency, 0.0008, flows);
}
await snapshots.captureAll();

console.log(`Datos de demo cargados en ${file}`);
db.close();
