import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createCryptoService } from '../src/crypto/service.js';

const fakePrices = {
  name: 'Test',
  mock: true,
  async getQuotes(assets) {
    // [price, previous close]
    const table = { BTC: [100000, 80000], ETH: [4000, null], USDT: [1, 1], BNB: [500, 500] };
    return Object.fromEntries(
      assets.map((a) => [a, table[a] ? { price: table[a][0], previousClose: table[a][1] } : null]),
    );
  },
};

function setup() {
  const db = openDb(':memory:');
  return createCryptoService(db, fakePrices);
}

const amounts = async (svc) =>
  Object.fromEntries((await svc.getHoldings()).holdings.map((h) => [h.asset, h.amount]));

test('manual holdings are upserted, normalized and valued', async () => {
  const svc = setup();
  svc.setHolding(' btc ', '0.5');
  svc.setHolding('USDT', 1000);
  svc.setHolding('BTC', 0.25); // correction overwrites
  const { holdings, total } = await svc.getHoldings();
  assert.deepEqual(holdings.map((h) => [h.asset, h.amount, h.value]), [
    ['BTC', 0.25, 25000],
    ['USDT', 1000, 1000],
  ]);
  assert.equal(total, 26000);
});

test('an exchange moves value between assets and applies the fee', async () => {
  const svc = setup();
  svc.setHolding('USDT', 1000);
  svc.createExchange({
    executedAt: '2026-09-20T10:30',
    fromAsset: 'USDT', fromAmount: '400',
    toAsset: 'ETH', toAmount: '0.1',
    feeAsset: 'ETH', feeAmount: '0.0001',
  });
  assert.deepEqual(await amounts(svc), { ETH: 0.0999, USDT: 600 });
  assert.equal(svc.listExchanges().length, 1);
});

test('fee is optional and float noise is removed', async () => {
  const svc = setup();
  svc.setHolding('USDT', 0.3);
  svc.createExchange({ executedAt: '2026-09-20T10:30', fromAsset: 'USDT', fromAmount: 0.1, toAsset: 'BNB', toAmount: 0.2 });
  svc.createExchange({ executedAt: '2026-09-20T10:31', fromAsset: 'USDT', fromAmount: 0.2, toAsset: 'BNB', toAmount: 0.1 });
  assert.deepEqual(await amounts(svc), { BNB: 0.3, USDT: 0 });
});

test('an exchange is rejected when the balance is not enough', async () => {
  const svc = setup();
  svc.setHolding('USDT', 100);
  assert.throws(
    () => svc.createExchange({ executedAt: '2026-09-20T10:30', fromAsset: 'USDT', fromAmount: 150, toAsset: 'BTC', toAmount: 0.001 }),
    /No alcanza el saldo de USDT/,
  );
  assert.deepEqual(await amounts(svc), { USDT: 100 });
  assert.equal(svc.listExchanges().length, 0);
});

test('same asset on both sides is rejected', () => {
  const svc = setup();
  svc.setHolding('BTC', 1);
  assert.throws(
    () => svc.createExchange({ executedAt: '2026-09-20T10:30', fromAsset: 'BTC', fromAmount: 1, toAsset: 'btc', toAmount: 1 }),
    /tienen que ser distintas/,
  );
});

test('deleting an exchange reverts its effect', async () => {
  const svc = setup();
  svc.setHolding('USDT', 1000);
  const ex = svc.createExchange({
    executedAt: '2026-09-20T10:30', fromAsset: 'USDT', fromAmount: 500, toAsset: 'BTC', toAmount: 0.005, feeAsset: 'USDT', feeAmount: 1,
  });
  svc.deleteExchange(ex.id);
  assert.deepEqual(await amounts(svc), { BTC: 0, USDT: 1000 });
  assert.equal(svc.listExchanges().length, 0);
});

test('deleting is blocked if reverting would leave a negative balance', async () => {
  const svc = setup();
  svc.setHolding('USDT', 1000);
  const ex = svc.createExchange({ executedAt: '2026-09-20T10:30', fromAsset: 'USDT', fromAmount: 500, toAsset: 'BTC', toAmount: 0.005 });
  svc.setHolding('BTC', 0.001); // user spent part of it and corrected holdings
  assert.throws(() => svc.deleteExchange(ex.id), /No se puede borrar/);
  assert.equal(svc.listExchanges().length, 1);
});

test('goal can be set and cleared', () => {
  const svc = setup();
  assert.equal(svc.getGoal(), null);
  svc.setGoal('50000');
  assert.equal(svc.getGoal(), 50000);
  svc.setGoal(null);
  assert.equal(svc.getGoal(), null);
  assert.throws(() => svc.setGoal(-1), /mayor/);
});

test('price provider failures do not break holdings', async () => {
  const db = openDb(':memory:');
  const svc = createCryptoService(db, { name: 'X', mock: false, getQuotes: async () => { throw new Error('offline'); } });
  svc.setHolding('BTC', 1);
  const res = await svc.getHoldings();
  assert.equal(res.holdings[0].value, null);
  assert.equal(res.priceSource.error, 'offline');
});

test('day change is computed from the previous close of each asset', async () => {
  const svc = setup();
  svc.setHolding('BTC', 0.1); // 10000 now, 8000 at previous close
  svc.setHolding('ETH', 1); // no previous close: counts as unchanged
  svc.setHolding('USDT', 1000);
  const res = await svc.getHoldings();
  const byAsset = Object.fromEntries(res.holdings.map((h) => [h.asset, h]));
  assert.equal(byAsset.BTC.dayChangePct, 25);
  assert.equal(byAsset.ETH.dayChangePct, null);
  assert.equal(res.total, 15000);
  assert.equal(res.dayChange, 2000);
  assert.equal(res.dayChangePct, 15.3846153846154); // 2000 / 13000
  assert.equal(byAsset.BTC.weight, 66.6666666666667);
});

test('snapshot values are in USDT', async () => {
  const svc = setup();
  assert.deepEqual(await svc.snapshotValues(), []);
  svc.setHolding('BTC', 0.01);
  assert.deepEqual(await svc.snapshotValues(), [{ value: 1000, currency: 'USDT' }]);
});
