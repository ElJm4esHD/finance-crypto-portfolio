import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { mockCryptoProvider } from '../src/prices/mock-crypto.js';
import { mockMarketProvider } from '../src/prices/mock-market.js';

function setup() {
  const { app } = buildApp({ db: openDb(':memory:'), cryptoPrices: mockCryptoProvider, marketPrices: mockMarketProvider });
  return app;
}

test('crypto flow over HTTP', async (t) => {
  const app = setup();
  t.after(() => app.close());

  let res = await app.inject({ method: 'PUT', url: '/api/crypto/holdings', payload: { asset: 'usdt', amount: 1000 } });
  assert.equal(res.statusCode, 200);

  res = await app.inject({
    method: 'POST',
    url: '/api/crypto/exchanges',
    payload: { executedAt: '2026-09-20T10:00', fromAsset: 'USDT', fromAmount: 5000, toAsset: 'BTC', toAmount: 0.05 },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /No alcanza el saldo de USDT/);

  res = await app.inject({
    method: 'POST',
    url: '/api/crypto/exchanges',
    payload: { executedAt: '2026-09-20T10:00', fromAsset: 'USDT', fromAmount: 500, toAsset: 'BTC', toAmount: 0.005 },
  });
  assert.equal(res.statusCode, 201);

  res = await app.inject({ method: 'PUT', url: '/api/crypto/goal', payload: { amount: 5000 } });
  assert.deepEqual(res.json(), { goal: 5000 });

  const holdings = (await app.inject('/api/crypto/holdings')).json();
  assert.deepEqual(holdings.holdings.map((h) => h.asset).sort(), ['BTC', 'USDT']);
  assert.equal(holdings.priceSource.mock, true);
  assert.equal(holdings.goal, 5000);

  const growth = (await app.inject('/api/crypto/growth')).json();
  assert.equal(growth.goal, 5000);
  assert.ok(Array.isArray(growth.series.daily));
});

test('cedears flow over HTTP', async (t) => {
  const app = setup();
  t.after(() => app.close());

  let res = await app.inject({
    method: 'POST',
    url: '/api/cedears/operations',
    payload: { type: 'buy', ticker: 'aapl.ba', quantity: 10, price: 15000, currency: 'ARS', commission: 100, date: '2026-09-20' },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Fondos insuficientes en ARS/);

  res = await app.inject({
    method: 'POST',
    url: '/api/cedears/cash-movements',
    payload: { type: 'deposit', currency: 'ARS', amount: 200000, date: '2026-09-19' },
  });
  assert.equal(res.statusCode, 201);

  res = await app.inject({
    method: 'POST',
    url: '/api/cedears/operations',
    payload: { type: 'buy', ticker: 'aapl.ba', quantity: 10, price: 15000, currency: 'ARS', commission: 100, date: '2026-09-20' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().ticker, 'AAPL.BA');

  const portfolio = (await app.inject('/api/cedears/portfolio')).json();
  assert.equal(portfolio.cash.ARS, 49900);
  assert.equal(portfolio.positions[0].weight, 100);

  res = await app.inject({ method: 'DELETE', url: '/api/cedears/operations/999' });
  assert.equal(res.statusCode, 404);
  res = await app.inject({ method: 'DELETE', url: '/api/cedears/operations/abc' });
  assert.equal(res.statusCode, 404);
});

test('malformed JSON gets a clean 400', async (t) => {
  const app = setup();
  t.after(() => app.close());
  const res = await app.inject({
    method: 'POST',
    url: '/api/crypto/exchanges',
    headers: { 'content-type': 'application/json' },
    payload: '{nope',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'Pedido inválido.');
});
