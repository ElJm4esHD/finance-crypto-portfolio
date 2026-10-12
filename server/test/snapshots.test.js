import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MIGRATIONS, migrate, openDb } from '../src/db.js';
import { createSnapshotService } from '../src/snapshots/service.js';

const silent = { warn() {} };

const rows = (db, portfolio) =>
  db.prepare('SELECT date, currency, value FROM snapshots WHERE portfolio = ? ORDER BY date, currency').all(portfolio);

test('capturing twice on the same day overwrites the value', async () => {
  let value = 100;
  const db = openDb(':memory:');
  const svc = createSnapshotService(db, {
    crypto: { snapshotValues: async () => [{ value, currency: 'USDT' }] },
    cedears: { snapshotValues: async () => [] },
  }, silent);
  await svc.capture('crypto', '2026-09-01');
  value = 120;
  await svc.capture('crypto', '2026-09-01');
  await svc.capture('cedears', '2026-09-01'); // nothing to record
  assert.deepEqual(rows(db, 'crypto'), [{ date: '2026-09-01', currency: 'USDT', value: 120 }]);
  assert.deepEqual(rows(db, 'cedears'), []);
  assert.equal(svc.has('crypto', '2026-09-01'), true);
  assert.equal(svc.has('cedears', '2026-09-01'), false);
});

test('each currency gets its own row', async () => {
  const db = openDb(':memory:');
  const svc = createSnapshotService(db, {
    cedears: { snapshotValues: async () => [{ value: 10, currency: 'USD' }, { value: 5000, currency: 'ARS' }] },
  }, silent);
  await svc.capture('cedears', '2026-09-01');
  assert.deepEqual(rows(db, 'cedears').map((r) => r.currency), ['ARS', 'USD']);
});

test('a failing price source skips the snapshot instead of crashing', async () => {
  const db = openDb(':memory:');
  const svc = createSnapshotService(db, {
    crypto: { snapshotValues: async () => { throw new Error('offline'); } },
  }, silent);
  assert.deepEqual(await svc.capture('crypto', '2026-09-01'), []);
  assert.deepEqual(rows(db, 'crypto'), []);
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

test('migration v5 starts the crypto invested amount at the first snapshot', () => {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS.slice(0, 4)) {
    if (typeof m === 'function') m(db);
    else db.exec(m);
  }
  db.pragma('user_version = 4');
  db.exec(`
    INSERT INTO crypto_holdings (asset, amount) VALUES ('BTC', 0.1);
    INSERT INTO snapshots VALUES ('crypto', '2026-09-20', 'USDT', 9000), ('crypto', '2026-09-10', 'USDT', 8000);
    INSERT INTO price_cache VALUES ('fx:dolarapi', 'MEP', '{"buy":1400,"sell":1420}', '2026-09-23T13:30:00.000Z');`);
  migrate(db);
  const setting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  assert.equal(setting('crypto_invested_opening'), '8000');
  assert.equal(setting('crypto_invested_opening_date'), '2026-09-10');
  assert.deepEqual(db.prepare('SELECT * FROM fx_rates').all(), [{ date: '2026-09-23', rate: 1420 }]);
});
