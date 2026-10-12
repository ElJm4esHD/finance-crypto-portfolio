import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createCedearService } from '../src/cedears/service.js';
import { runDataFixes } from '../src/lib/data-fixes.js';

const silent = { info() {}, error() {}, warn() {} };
const market = { id: 't', name: 'T', mock: true, getQuotes: async () => ({}) };

test('the one-time fixes rename SPYD to SPY and set the real cash, once', async () => {
  const db = openDb(':memory:');
  const cedears = createCedearService(db, market);
  cedears.createCashMovement({ type: 'deposit', currency: 'USD', amount: 20000, date: '2026-09-01' });
  cedears.createCashMovement({ type: 'deposit', currency: 'ARS', amount: 15000000, date: '2026-09-01' });
  cedears.createOperation({ type: 'buy', ticker: 'SPYD', quantity: 3, price: 650, currency: 'USD', date: '2026-09-02' });
  const before = (await cedears.getPortfolio()).totals;

  const copies = [];
  await runDataFixes(db, { cedears }, { log: silent, backup: async (name) => copies.push(name) });
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
  await runDataFixes(db, { cedears }, { log: silent, backup: async (name) => copies.push(name) });
  assert.equal((await cedears.getPortfolio()).cash.USD, 113.02);
  assert.equal(copies.length, 1);
});

test('the one-time fixes leave an empty database alone', async () => {
  const db = openDb(':memory:');
  const cedears = createCedearService(db, market);
  await runDataFixes(db, { cedears }, { log: silent });
  assert.deepEqual((await cedears.getPortfolio()).cash, { USD: 0, ARS: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'data_fix_%'").get().n, 0);
});
