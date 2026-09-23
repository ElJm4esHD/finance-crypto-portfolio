import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MIGRATIONS, migrate, openDb } from '../src/db.js';
import { aggregate, createSnapshotService } from '../src/snapshots/service.js';

const silent = { warn() {} };

test('aggregation keeps the last value of each period', () => {
  const points = [
    { date: '2026-01-30', value: 1 },
    { date: '2026-01-31', value: 2 }, // Saturday, week 05
    { date: '2026-02-01', value: 3 }, // Sunday, week 05
    { date: '2026-02-02', value: 4 }, // Monday, week 06
    { date: '2027-03-01', value: 5 },
  ];
  assert.deepEqual(aggregate(points, 'weekly').map((p) => p.value), [3, 4, 5]);
  assert.deepEqual(aggregate(points, 'monthly').map((p) => p.value), [2, 4, 5]);
  assert.deepEqual(aggregate(points, 'yearly').map((p) => p.value), [4, 5]);
  assert.equal(aggregate(points, 'daily').length, 5);
});

test('capturing twice on the same day overwrites the value', async () => {
  let value = 100;
  const svc = createSnapshotService(openDb(':memory:'), {
    crypto: { snapshotValues: async () => [{ value, currency: 'USDT' }] },
    cedears: { snapshotValues: async () => [] },
  }, silent);
  await svc.capture('crypto', '2026-09-01');
  value = 120;
  await svc.capture('crypto', '2026-09-01');
  await svc.capture('cedears', '2026-09-01'); // nothing to record
  const [usdt] = svc.getGrowth('crypto').currencies;
  assert.equal(usdt.currency, 'USDT');
  assert.deepEqual(usdt.series.daily, [{ date: '2026-09-01', value: 120 }]);
  assert.deepEqual(usdt.available, ['daily']);
  assert.deepEqual(svc.getGrowth('cedears').currencies, []);
});

test('each currency gets its own series', async () => {
  const svc = createSnapshotService(openDb(':memory:'), {
    cedears: { snapshotValues: async () => [{ value: 10, currency: 'USD' }, { value: 5000, currency: 'ARS' }] },
  }, silent);
  await svc.capture('cedears', '2026-09-01');
  await svc.capture('cedears', '2026-09-02');
  const byCurrency = Object.fromEntries(svc.getGrowth('cedears').currencies.map((c) => [c.currency, c]));
  assert.deepEqual(Object.keys(byCurrency).sort(), ['ARS', 'USD']);
  assert.deepEqual(byCurrency.ARS.series.daily.map((p) => p.value), [5000, 5000]);
});

test('longer views become available as history accumulates', async () => {
  const svc = createSnapshotService(openDb(':memory:'), {
    crypto: { snapshotValues: async () => [{ value: 1, currency: 'USDT' }] },
  }, silent);
  for (const d of ['2025-12-30', '2026-01-02', '2026-01-10']) await svc.capture('crypto', d);
  assert.deepEqual(svc.getGrowth('crypto').currencies[0].available, ['daily', 'weekly', 'monthly', 'yearly']);
});

test('a failing price source skips the snapshot instead of crashing', async () => {
  const svc = createSnapshotService(openDb(':memory:'), {
    crypto: { snapshotValues: async () => { throw new Error('offline'); } },
  }, silent);
  assert.deepEqual(await svc.capture('crypto', '2026-09-01'), []);
  assert.deepEqual(svc.getGrowth('crypto').currencies, []);
});

test('migration v2 keeps crypto snapshots and drops the old USD-consolidated CEDEAR ones', () => {
  const db = new Database(':memory:');
  db.exec(MIGRATIONS[0]);
  db.pragma('user_version = 1');
  db.prepare("INSERT INTO snapshots VALUES ('crypto', '2026-09-22', 1000, 'USDT')").run();
  db.prepare("INSERT INTO snapshots VALUES ('cedears', '2026-09-22', 5000, 'USD')").run();
  migrate(db);
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
  assert.deepEqual(db.prepare('SELECT portfolio, date, currency, value FROM snapshots').all(), [
    { portfolio: 'crypto', date: '2026-09-22', currency: 'USDT', value: 1000 },
  ]);
});

test('migration v3 clears cash movements and sets the available cash, keeping operations', async () => {
  const { createCedearService } = await import('../src/cedears/service.js');
  const db = new Database(':memory:');
  db.exec(MIGRATIONS[0]);
  db.exec(MIGRATIONS[1]);
  db.pragma('user_version = 2');
  db.exec(`
    INSERT INTO cedear_cash_movements (type, currency, amount, date) VALUES ('deposit', 'USD', 1000, '2026-09-01');
    INSERT INTO cedear_operations (type, ticker, quantity, price, currency, commission, date) VALUES
      ('buy', 'SPY', 2, 500.4, 'USD', 1.21, '2026-09-02'),
      ('buy', 'AAPL.BA', 3, 15000, 'ARS', 0, '2026-09-02'),
      ('sell', 'SPY', 1, 510.3, 'USD', 0.7, '2026-09-03');`);
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cedear_cash_movements').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cedear_operations').get().n, 3);
  const svc = createCedearService(db, { name: 'T', mock: true, getQuotes: async () => ({}) });
  const { cash, positions } = await svc.getPortfolio();
  assert.deepEqual(cash, { USD: 12890, ARS: 14814550 });
  assert.deepEqual(positions.map((p) => [p.ticker, p.quantity]).sort(), [['AAPL.BA', 3], ['SPY', 1]]);
});

test('migration v3 leaves an empty database alone', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'cedears_opening_cash_%'").get().n, 0);
});
