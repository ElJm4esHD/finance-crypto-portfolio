import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { localDate } from '../src/lib/dates.js';
import { createCedearService } from '../src/cedears/service.js';
import { createCryptoService } from '../src/crypto/service.js';
import { createSnapshotRepairs } from '../src/snapshots/repairs.js';

const silent = { warn() {}, info() {} };
// Daily closes: SPYD 50, SPY 700 (USD), BTC 100000 before 09-03 and 120000 after.
const CLOSES = {
  SPYD: [{ date: '2026-09-01', close: 50 }],
  SPY: [{ date: '2026-09-01', close: 700 }],
  BTC: [{ date: '2026-09-01', close: 100000 }, { date: '2026-09-03', close: 120000 }],
  ETH: [{ date: '2026-09-01', close: 4000 }],
};
const fakeCloses = (state) => async (symbol) => {
  if (state.down) throw new Error('offline');
  return CLOSES[symbol] ? { currency: symbol === 'BTC' || symbol === 'ETH' ? 'USDT' : 'USD', closes: CLOSES[symbol] } : null;
};

function setup() {
  const db = openDb(':memory:');
  const api = { down: false };
  const repairs = createSnapshotRepairs(db, { closes: { crypto: fakeCloses(api), cedears: fakeCloses(api) }, log: silent });
  const market = { id: 't', name: 'T', mock: true, getQuotes: async () => ({}) };
  const coins = {
    id: 't', name: 'T', mock: true,
    getQuotes: async (assets) => Object.fromEntries(assets.map((a) => [a, { price: a === 'USDT' ? 1 : 100000, previousClose: null }])),
  };
  const cedears = createCedearService(db, market, { repairs });
  const crypto = createCryptoService(db, coins, { repairs });
  const snap = (portfolio, date, currency, value) =>
    db.prepare('INSERT INTO snapshots (portfolio, date, currency, value) VALUES (?, ?, ?, ?)').run(portfolio, date, currency, value);
  const series = (portfolio, currency) =>
    db.prepare('SELECT date, value FROM snapshots WHERE portfolio = ? AND currency = ? ORDER BY date').all(portfolio, currency).map((r) => [r.date, r.value]);
  return { db, api, repairs, cedears, crypto, snap, series };
}

test('renaming a CEDEAR position keeps its operations and fixes the past snapshots', async () => {
  const { db, repairs, cedears, snap, series } = setup();
  cedears.createCashMovement({ type: 'deposit', currency: 'USD', amount: 1000, date: '2026-09-01' });
  cedears.createOperation({ type: 'buy', ticker: 'SPYD', quantity: 1, price: 600, currency: 'USD', date: '2026-09-02' });
  snap('cedears', '2026-09-01', 'USD', 1000);
  snap('cedears', '2026-09-02', 'USD', 450); // 400 cash + 1 SPYD at 50
  snap('cedears', localDate(), 'USD', 999); // today is recaptured live, never repaired

  cedears.renamePosition({ ticker: 'SPYD', currency: 'USD', newTicker: 'SPY' });
  assert.equal(await repairs.process(), true);

  const ops = cedears.listOperations();
  assert.deepEqual(ops.map((o) => [o.ticker, o.quantity, o.price, o.date]), [['SPY', 1, 600, '2026-09-02']]);
  assert.deepEqual(series('cedears', 'USD'), [['2026-09-01', 1000], ['2026-09-02', 1100], [localDate(), 999]]);
  assert.equal(cedears.listCashMovements().length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM snapshot_repairs').get().n, 0);
});

test('editing an operation corrects positions, cash and the history from its date', async () => {
  const { repairs, cedears, snap, series } = setup();
  cedears.createCashMovement({ type: 'deposit', currency: 'USD', amount: 2000, date: '2026-09-01' });
  const op = cedears.createOperation({ type: 'buy', ticker: 'SPY', quantity: 1, price: 700, currency: 'USD', date: '2026-09-02' });
  snap('cedears', '2026-09-01', 'USD', 2000);
  snap('cedears', '2026-09-02', 'USD', 2000);

  // Actually it was 2 units at 650, bought one day later.
  cedears.updateOperation(op.id, { ticker: 'SPY', quantity: 2, price: 650, currency: 'USD', date: '2026-09-03' });
  await repairs.process();

  const { positions, cash, totals } = await cedears.getPortfolio();
  assert.deepEqual([positions[0].quantity, positions[0].avgPrice, cash.USD], [2, 650, 700]);
  assert.equal(totals.USD.invested, 2000);
  assert.equal(cedears.listOperations().length, 1);
  // 09-02 no longer has the old buy: 2000 cash.
  assert.deepEqual(series('cedears', 'USD'), [['2026-09-01', 2000], ['2026-09-02', 2000]]);
  assert.throws(() => cedears.updateOperation(op.id, { ticker: 'SPY', quantity: 10, price: 650, currency: 'USD', date: '2026-09-03' }), /quedaría en negativo/);
});

test('correcting the available cash records nothing and keeps the performance', async () => {
  const { cedears, snap, series } = setup();
  cedears.createCashMovement({ type: 'deposit', currency: 'USD', amount: 20000, date: '2026-09-01' });
  cedears.createOperation({ type: 'buy', ticker: 'SPY', quantity: 1, price: 700, currency: 'USD', date: '2026-09-02' });
  snap('cedears', '2026-09-02', 'USD', 20000);
  const before = (await cedears.getPortfolio()).totals.USD;

  const cash = cedears.setCash({ USD: 13.02 });
  assert.equal(cash.USD, 13.02);
  const after = (await cedears.getPortfolio()).totals.USD;
  assert.equal(after.cash, 13.02);
  assert.equal(after.invested, 713.02); // 20000 − (19300 − 13.02)
  assert.equal(after.performance, before.performance);
  assert.equal(cedears.listCashMovements().length, 1); // no withdrawal added
  // The past moves by the same amount, right away (no prices needed).
  assert.deepEqual(series('cedears', 'USD'), [['2026-09-02', 713.02]]);
});

test('crypto corrections fix the past balance at past prices; queued while the API is down', async () => {
  const { api, repairs, crypto, snap, series } = setup();
  crypto.setHolding('USDT', 1000);
  await repairs.process();
  snap('crypto', '2026-09-01', 'USDT', 1000);
  snap('crypto', '2026-09-03', 'USDT', 1000);

  api.down = true;
  crypto.setHolding('BTC', 0.01); // was missing since always
  assert.equal(await repairs.process(), false);
  assert.equal(repairs.pending(), 1);
  assert.deepEqual(series('crypto', 'USDT'), [['2026-09-01', 1000], ['2026-09-03', 1000]]);

  api.down = false;
  assert.equal(await repairs.process(), true);
  assert.deepEqual(series('crypto', 'USDT'), [['2026-09-01', 2000], ['2026-09-03', 2200]]);

  // Renaming moves the value to the other coin's prices.
  crypto.renameAsset('BTC', 'ETH');
  await repairs.process();
  assert.deepEqual(series('crypto', 'USDT'), [['2026-09-01', 1040], ['2026-09-03', 1040]]);
  assert.deepEqual((await crypto.getHoldings()).holdings.map((h) => h.asset).sort(), ['ETH', 'USDT']);
});

test('editing a crypto exchange or contribution changes balances as if it had always been so', async () => {
  const { crypto } = setup();
  crypto.setHolding('USDT', 1000);
  const ex = crypto.createExchange({ executedAt: '2026-09-02T10:00', fromAsset: 'USDT', fromAmount: 500, toAsset: 'BTC', toAmount: 0.005 });
  crypto.updateExchange(ex.id, { executedAt: '2026-09-02T11:00', fromAmount: 400, toAmount: 0.004 });
  let h = Object.fromEntries((await crypto.getHoldings()).holdings.map((x) => [x.asset, x.amount]));
  assert.deepEqual(h, { USDT: 600, BTC: 0.004 });
  assert.equal(crypto.listExchanges().length, 1);

  const flow = await crypto.createFlow({ type: 'deposit', asset: 'USDT', amount: 100, executedAt: '2026-09-03T10:00' });
  crypto.updateFlow(flow.id, { amount: 150, valueUsdt: 150, executedAt: '2026-09-03T10:00' });
  h = Object.fromEntries((await crypto.getHoldings()).holdings.map((x) => [x.asset, x.amount]));
  assert.equal(h.USDT, 750);
  assert.equal(crypto.getInvested(), 150);
  assert.equal(crypto.listFlows().length, 1);
});
