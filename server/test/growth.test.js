import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createCryptoService } from '../src/crypto/service.js';
import { createCedearService } from '../src/cedears/service.js';
import { createGrowthService } from '../src/growth/service.js';

const prices = {
  id: 'test',
  name: 'Test',
  mock: true,
  getQuotes: async (assets) => Object.fromEntries(assets.map((a) => [a, { price: a === 'BTC' ? 100000 : 1, previousClose: null }])),
};
const market = { id: 'test', name: 'Test', mock: true, getQuotes: async () => ({}) };

function setup(history = [{ date: '2026-09-01', rate: 1000 }, { date: '2026-09-03', rate: 1200 }]) {
  const db = openDb(':memory:');
  const fx = { get: () => ({ rate: 1200 }), history: () => history };
  const crypto = createCryptoService(db, prices);
  const cedears = createCedearService(db, market, { fx });
  const snap = (portfolio, date, currency, value) =>
    db.prepare('INSERT INTO snapshots (portfolio, date, currency, value) VALUES (?, ?, ?, ?)').run(portfolio, date, currency, value);
  return { db, crypto, cedears, snap, growth: createGrowthService(db, { crypto, cedears, fx }) };
}

test('crypto contributions are valued at market price and count as invested', async () => {
  const { crypto } = setup();
  await crypto.createFlow({ type: 'deposit', asset: 'BTC', amount: 0.01, executedAt: '2026-09-02T10:00' });
  await crypto.createFlow({ type: 'deposit', asset: 'USDT', amount: 500, valueUsdt: 480, executedAt: '2026-09-02T11:00' });
  const h = await crypto.getHoldings();
  assert.equal(h.total, 1500);
  assert.deepEqual([h.invested, h.performance], [1480, 20]);

  await crypto.createFlow({ type: 'withdrawal', asset: 'USDT', amount: 100, executedAt: '2026-09-03T10:00' });
  assert.equal(crypto.getInvested(), 1380);
  await assert.rejects(crypto.createFlow({ type: 'withdrawal', asset: 'BTC', amount: 1, executedAt: '2026-09-03T10:00' }), /No podés retirar/);

  // Deleting a contribution reverts the balance too.
  const [last] = crypto.listFlows();
  crypto.deleteFlow(last.id);
  assert.equal((await crypto.getHoldings()).holdings.find((x) => x.asset === 'USDT').amount, 500);
});

test('balance corrections and the opening amount are not contributions', async () => {
  const { crypto } = setup();
  crypto.setHolding('BTC', 0.02);
  crypto.setOpening(1500);
  const h = await crypto.getHoldings();
  assert.deepEqual([h.total, h.invested, h.performance], [2000, 1500, 500]);
  assert.deepEqual(crypto.listFlows(), []);
});

test('crypto growth carries invested money and flags each contribution', async () => {
  const { crypto, snap, growth } = setup();
  crypto.setOpening(1000);
  snap('crypto', '2026-09-01', 'USDT', 1000);
  await crypto.createFlow({ type: 'deposit', asset: 'USDT', amount: 500, executedAt: '2026-09-02T10:00' });
  snap('crypto', '2026-09-02', 'USDT', 1600);
  snap('crypto', '2026-09-03', 'USDT', 1550);
  const usd = growth.get('crypto', 'USD');
  assert.deepEqual(usd.points, [
    { date: '2026-09-01', value: 1000, invested: 1000 },
    { date: '2026-09-02', value: 1600, invested: 1500 },
    { date: '2026-09-03', value: 1550, invested: 1500 },
  ]);
  assert.deepEqual(usd.flows, [{ date: '2026-09-02', amount: 500 }]);
  // In pesos every day uses its own dólar MEP (09-02 still uses 09-01's).
  const ars = growth.get('crypto', 'ARS');
  assert.deepEqual(ars.points.map((p) => [p.value, p.invested]), [[1000000, 1000000], [1600000, 1500000], [1860000, 1800000]]);
  assert.deepEqual(ars.flows, [{ date: '2026-09-02', amount: 500000 }]);
});

test('CEDEAR growth adds both currencies and carries a currency that skipped a day', () => {
  const { cedears, snap, growth } = setup();
  cedears.createCashMovement({ type: 'deposit', currency: 'ARS', amount: 100000, date: '2026-09-01' });
  cedears.createCashMovement({ type: 'deposit', currency: 'USD', amount: 100, date: '2026-09-03' });
  snap('cedears', '2026-09-01', 'ARS', 100000);
  snap('cedears', '2026-09-03', 'USD', 110);
  const g = growth.get('cedears', 'ARS');
  assert.deepEqual(g.points, [
    { date: '2026-09-01', value: 100000, invested: 100000 },
    { date: '2026-09-03', value: 232000, invested: 220000 }, // ARS carried + 110 × 1200
  ]);
  assert.deepEqual(g.flows, [{ date: '2026-09-01', amount: 100000 }, { date: '2026-09-03', amount: 120000 }]);
});

test('without any dólar MEP the history cannot be converted', () => {
  const db = openDb(':memory:');
  const fx = { get: () => null, history: () => [] };
  const crypto = createCryptoService(db, prices);
  const cedears = createCedearService(db, market, { fx });
  db.prepare("INSERT INTO snapshots VALUES ('crypto', '2026-09-01', 'USDT', 10)").run();
  const growth = createGrowthService(db, { crypto, cedears, fx });
  assert.equal(growth.get('crypto', 'USD').points.length, 1);
  assert.deepEqual(growth.get('crypto', 'ARS'), { currency: 'ARS', points: [], flows: [], missingRate: true });
});

test('contributions older than the first point are not flagged (history reset)', async () => {
  const { crypto, snap, growth } = setup();
  await crypto.createFlow({ type: 'deposit', asset: 'USDT', amount: 500, executedAt: '2026-08-01T10:00' });
  snap('crypto', '2026-09-01', 'USDT', 500);
  const g = growth.get('crypto', 'USD');
  assert.deepEqual(g.points, [{ date: '2026-09-01', value: 500, invested: 500 }]);
  assert.deepEqual(g.flows, []);
});
