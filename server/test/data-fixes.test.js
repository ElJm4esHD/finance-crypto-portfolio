import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createCedearService } from '../src/cedears/service.js';
import { createSnapshotService } from '../src/snapshots/service.js';
import { runDataFixes } from '../src/lib/data-fixes.js';

const silent = { info() {}, error() {}, warn() {} };
const market = { id: 't', name: 'T', mock: true, getQuotes: async () => ({}) };

function setup() {
  const db = openDb(':memory:');
  const cedears = createCedearService(db, market);
  const snapshots = createSnapshotService(db, { cedears }, silent);
  return { db, cedears, snapshots, services: { cedears, snapshots } };
}

test('the one-time fixes rename SPYD to SPY and set the real cash, once', async () => {
  const { db, cedears, services } = setup();
  cedears.createCashMovement({ type: 'deposit', currency: 'USD', amount: 20000, date: '2026-09-01' });
  cedears.createCashMovement({ type: 'deposit', currency: 'ARS', amount: 15000000, date: '2026-09-01' });
  cedears.createOperation({ type: 'buy', ticker: 'SPYD', quantity: 3, price: 650, currency: 'USD', date: '2026-09-02' });
  const before = (await cedears.getPortfolio()).totals;

  const copies = [];
  await runDataFixes(db, services, { log: silent, backup: async (name) => copies.push(name) });
  assert.equal(copies.length, 1);

  const ops = cedears.listOperations();
  assert.deepEqual(ops.map((o) => [o.ticker, o.quantity, o.price, o.date]), [['SPY', 3, 650, '2026-09-02']]);
  const { cash, totals } = await cedears.getPortfolio();
  assert.deepEqual(cash, { USD: 13.02, ARS: 21291.74 });
  assert.equal(cedears.listCashMovements().length, 2); // no withdrawal recorded
  assert.equal(totals.USD.performance, before.USD.performance);
  assert.equal(totals.ARS.performance, before.ARS.performance);

  // Running again does nothing, even if the data changes later.
  cedears.createCashMovement({ type: 'deposit', currency: 'USD', amount: 100, date: '2026-10-01' });
  await runDataFixes(db, services, { log: silent, backup: async (name) => copies.push(name) });
  assert.equal((await cedears.getPortfolio()).cash.USD, 113.02);
  assert.equal(copies.length, 1);
});

test('the growth history is reset once, keeping holdings, operations and cash', async () => {
  const { db, cedears, snapshots, services } = setup();
  cedears.createCashMovement({ type: 'deposit', currency: 'USD', amount: 1000, date: '2026-09-01' });
  cedears.createOperation({ type: 'buy', ticker: 'SPY', quantity: 1, price: 700, currency: 'USD', date: '2026-09-02' });
  db.exec(`
    INSERT INTO snapshots VALUES ('cedears', '2026-09-02', 'USD', -21000), ('crypto', '2026-09-02', 'USDT', 5);
    INSERT INTO snapshot_repairs (portfolio, terms) VALUES ('crypto', '[]');`);
  const cashBefore = (await cedears.getPortfolio()).cash;

  await runDataFixes(db, services, { log: silent });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM snapshot_repairs').get().n, 0);
  assert.equal(snapshots.isEmpty('cedears'), true);
  assert.equal(cedears.listOperations().length, 1);
  assert.equal(cedears.listCashMovements().length, 1);
  assert.deepEqual((await cedears.getPortfolio()).cash, { ...cashBefore, USD: 13.02, ARS: 21291.74 });

  // The first point captured afterwards is not wiped again on the next start.
  db.exec("INSERT INTO snapshots VALUES ('cedears', '2026-10-12', 'USD', 713.02)");
  await runDataFixes(db, services, { log: silent });
  assert.equal(snapshots.isEmpty('cedears'), false);
});

test('the one-time fixes leave an empty database alone', async () => {
  const { db, cedears, services } = setup();
  await runDataFixes(db, services, { log: silent });
  assert.deepEqual((await cedears.getPortfolio()).cash, { USD: 0, ARS: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'data_fix_%'").get().n, 0);
});
