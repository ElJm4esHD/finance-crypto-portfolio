import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createCedearService } from '../src/cedears/service.js';

// Market price = avg price * 1.1, 1 USD = 1000 ARS.
const fakeMarket = {
  name: 'Test',
  mock: true,
  async getPrices(items) {
    return Object.fromEntries(items.map((i) => [`${i.ticker}|${i.currency}`, i.avgPrice * 1.1]));
  },
  async getUsdArsRate() {
    return 1000;
  },
};

function setup(provider = fakeMarket) {
  return createCedearService(openDb(':memory:'), provider);
}

const buy = (svc, ticker, quantity, price, extra = {}) =>
  svc.createOperation({ type: 'buy', ticker, quantity, price, currency: 'USD', commission: 0, date: '2026-09-01', ...extra });
const sell = (svc, ticker, quantity, price, extra = {}) =>
  svc.createOperation({ type: 'sell', ticker, quantity, price, currency: 'USD', commission: 0, date: '2026-09-02', ...extra });

test('buys are rejected without enough available cash', () => {
  const svc = setup();
  assert.throws(() => buy(svc, 'SPY', 1, 500), /Fondos insuficientes en USD/);
  svc.createCashMovement({ type: 'deposit', currency: 'USD', amount: 500, date: '2026-09-01' });
  assert.throws(() => buy(svc, 'SPY', 1, 500, { commission: 1 }), /Fondos insuficientes/);
  buy(svc, 'SPY', 1, 499, { commission: 1 }); // exactly the available amount
});

test('cash in one currency does not fund a buy in the other', () => {
  const svc = setup();
  svc.createCashMovement({ type: 'deposit', currency: 'USD', amount: 10000, date: '2026-09-01' });
  assert.throws(() => buy(svc, 'AAPL.BA', 1, 100, { currency: 'ARS' }), /Fondos insuficientes en ARS/);
});

test('weighted average price is recalculated on buys only', async () => {
  const svc = setup();
  svc.createCashMovement({ type: 'deposit', currency: 'USD', amount: 10000, date: '2026-09-01' });
  buy(svc, 'SPY', 10, 100);
  buy(svc, 'SPY', 30, 200); // (10*100 + 30*200) / 40 = 175
  sell(svc, 'SPY', 20, 300); // quantity drops, avg stays
  const { positions, cash } = await svc.getPortfolio();
  assert.equal(positions.length, 1);
  assert.equal(positions[0].quantity, 20);
  assert.equal(positions[0].avgPrice, 175);
  assert.equal(cash.USD, 10000 - 1000 - 6000 + 6000);
});

test('commissions affect cash but not the average price', async () => {
  const svc = setup();
  svc.createCashMovement({ type: 'deposit', currency: 'ARS', amount: 100000, date: '2026-09-01' });
  buy(svc, 'AAPL.BA', 2, 15000, { currency: 'ARS', commission: 150 });
  sell(svc, 'AAPL.BA', 1, 16000, { currency: 'ARS', commission: 80 });
  const { positions, cash } = await svc.getPortfolio();
  assert.equal(positions[0].avgPrice, 15000);
  assert.equal(cash.ARS, 100000 - 30150 + 15920);
});

test('selling more than held is rejected', () => {
  const svc = setup();
  svc.createCashMovement({ type: 'deposit', currency: 'USD', amount: 1000, date: '2026-09-01' });
  buy(svc, 'QQQ', 1, 400);
  assert.throws(() => sell(svc, 'QQQ', 2, 400), /No tenés suficientes QQQ/);
  assert.throws(() => sell(svc, 'QQQ', 1, 400, { currency: 'ARS' }), /No tenés suficientes QQQ en ARS/);
});

test('fully sold positions stay visible at zero', async () => {
  const svc = setup();
  svc.createCashMovement({ type: 'deposit', currency: 'USD', amount: 1000, date: '2026-09-01' });
  buy(svc, 'QQQ', 1, 400);
  buy(svc, 'SPY', 1, 500);
  sell(svc, 'QQQ', 1, 450);
  const { positions } = await svc.getPortfolio();
  assert.deepEqual(positions.map((p) => [p.ticker, p.quantity]), [['SPY', 1], ['QQQ', 0]]);
  assert.equal(positions[1].weight, 0);
});

test('weights, values and totals are consolidated in USD', async () => {
  const svc = setup();
  svc.createCashMovement({ type: 'deposit', currency: 'USD', amount: 1000, date: '2026-09-01' });
  svc.createCashMovement({ type: 'deposit', currency: 'ARS', amount: 2000000, date: '2026-09-01' });
  buy(svc, 'SPY', 1, 1000); // value 1100 USD
  buy(svc, 'AAPL.BA', 10, 110000, { currency: 'ARS' }); // value 1,210,000 ARS = 1210 USD
  const p = await svc.getPortfolio();
  const byTicker = Object.fromEntries(p.positions.map((r) => [r.ticker, r]));
  assert.equal(byTicker['AAPL.BA'].weight, 52.3809523809524);
  assert.equal(byTicker.SPY.weight, 47.6190476190476);
  assert.equal(byTicker.SPY.pnlPct, 10);
  assert.equal(p.totals.positionsUsd, 2310);
  assert.equal(p.totals.cashUsd, 900); // 0 USD + 900,000 ARS
  assert.equal(p.totals.totalUsd, 3210);
});

test('withdrawals cannot exceed available cash', () => {
  const svc = setup();
  svc.createCashMovement({ type: 'deposit', currency: 'USD', amount: 100, date: '2026-09-01' });
  assert.throws(
    () => svc.createCashMovement({ type: 'withdrawal', currency: 'USD', amount: 101, date: '2026-09-01' }),
    /No podés retirar/,
  );
});

test('deleting history is blocked when it would make the state inconsistent', async () => {
  const svc = setup();
  const dep = svc.createCashMovement({ type: 'deposit', currency: 'USD', amount: 1000, date: '2026-09-01' });
  const b = buy(svc, 'SPY', 2, 400);
  sell(svc, 'SPY', 1, 400);
  assert.throws(() => svc.deleteCashMovement(dep.id), /dinero disponible en USD quedaría en negativo/);
  assert.throws(() => svc.deleteOperation(b.id), /posición de SPY quedaría en negativo/);

  const s = svc.listOperations().find((o) => o.type === 'sell');
  svc.deleteOperation(s.id);
  svc.deleteOperation(b.id);
  const { positions, cash } = await svc.getPortfolio();
  assert.equal(positions.length, 0);
  assert.equal(cash.USD, 1000);
});

test('snapshot value falls back to cost when a price is missing', async () => {
  const svc = setup({ ...fakeMarket, getPrices: async () => ({}) });
  assert.equal(await svc.snapshotValue(), null);
  svc.createCashMovement({ type: 'deposit', currency: 'USD', amount: 1000, date: '2026-09-01' });
  buy(svc, 'SPY', 1, 600);
  assert.deepEqual(await svc.snapshotValue(), { value: 1000, currency: 'USD' });
});
