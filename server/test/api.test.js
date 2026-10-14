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
  assert.equal(typeof holdings.dayChangePct, 'number');

  const growth = (await app.inject('/api/crypto/growth')).json();
  assert.equal(growth.goal, 5000);
  assert.equal(growth.currency, 'USD');
  assert.ok(Array.isArray(growth.points) && Array.isArray(growth.flows));

  const csv = await app.inject('/api/crypto/export.csv');
  assert.equal(csv.statusCode, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.headers['content-disposition'], /attachment; filename="cripto-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.ok(csv.body.startsWith('﻿Exportación cripto'));
  assert.match(csv.body, /precios,Simulados: NO son precios reales de mercado/);
  assert.match(csv.body, /\r\nCartera\r\nmoneda,cantidad,precio_usdt,valor_usdt,peso_pct,variacion_dia_pct\r\n/);
  assert.match(csv.body, /\r\n2026-09-20 10:00,USDT,500,BTC,0\.005,,\r\n/);
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
  assert.equal(portfolio.totals.ARS.used, true);
  assert.equal(portfolio.totals.USD.used, false);

  const csv = (await app.inject('/api/cedears/export.csv')).body;
  assert.match(csv, /\r\nTotales por moneda\r\nmoneda,posiciones,disponible,total,invertido,rendimiento,rendimiento_pct,variacion_dia,variacion_dia_pct\r\nARS,/);
  assert.doesNotMatch(csv, /\r\nUSD,/);
  assert.match(csv, /\r\n2026-09-20,compra,AAPL\.BA,10,15000,ARS,100,150100\r\n/);
  assert.match(csv, /\r\n2026-09-19,depósito,ARS,200000,\r\n/);

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

test('CSV cells are quoted and protected against formulas', async (t) => {
  const app = setup();
  t.after(() => app.close());
  await app.inject({
    method: 'POST',
    url: '/api/cedears/cash-movements',
    payload: { type: 'deposit', currency: 'USD', amount: 10, date: '2026-09-19', note: '=HYPERLINK("x"), sueldo' },
  });
  const csv = (await app.inject('/api/cedears/export.csv')).body;
  assert.match(csv, /,"'=HYPERLINK\(""x""\), sueldo"\r\n/);
});

test('intraday charts and the dólar MEP over HTTP', async (t) => {
  const fx = { get: () => ({ rate: 1500, buy: 1480, sell: 1500, stale: null }) };
  const { app } = buildApp({ db: openDb(':memory:'), cryptoPrices: mockCryptoProvider, marketPrices: mockMarketProvider, fx });
  t.after(() => app.close());

  assert.equal((await app.inject('/api/fx/mep')).json().mep.rate, 1500);
  assert.equal((await app.inject('/api/crypto/holdings')).json().fx.rate, 1500);
  assert.equal((await app.inject('/api/cedears/portfolio')).json().fx.rate, 1500);

  const btc = (await app.inject('/api/crypto/chart/btc')).json();
  assert.equal(btc.asset, 'BTC');
  assert.equal(btc.points.length, 289);
  assert.deepEqual((await app.inject('/api/crypto/chart/USDT')).json().points, []);

  await app.inject({ method: 'PUT', url: '/api/crypto/holdings', payload: { asset: 'BTC', amount: 1 } });
  const lines = (await app.inject('/api/crypto/sparklines')).json();
  assert.deepEqual(Object.keys(lines), ['BTC']);
  assert.equal(lines.BTC.values.length, 48);
  // Line, color and % come from the same series: reference → current price.
  const h = (await app.inject('/api/crypto/holdings')).json().holdings.find((x) => x.asset === 'BTC');
  const v = lines.BTC.values;
  assert.equal(v.at(-1), h.price);
  assert.equal(Math.sign(v.at(-1) - v[0]), Math.sign(lines.BTC.changePct));
  assert.equal(lines.BTC.changePct, h.dayChangePct);

  const month = (await app.inject('/api/crypto/chart/BTC?range=1M')).json();
  assert.equal(month.range, '1M');
  assert.ok(month.points.length >= 30);
  const custom = (await app.inject('/api/crypto/chart/BTC?range=custom&from=2026-01-01&to=2026-01-10')).json();
  assert.equal(custom.points.length, 10);
  assert.equal((await app.inject('/api/crypto/chart/BTC?range=2X')).statusCode, 400);
  assert.equal((await app.inject('/api/cedears/chart/SPY?range=custom&from=2026-02-01&to=2026-01-01')).statusCode, 400);
  assert.ok((await app.inject('/api/cedears/chart/SPY?range=YTD')).json().points.length > 0);

  const spy = await app.inject('/api/cedears/chart/SPY');
  assert.equal(spy.statusCode, 200);
  assert.ok(spy.json().session.end > spy.json().session.start);
});

test('crypto contributions over HTTP', async (t) => {
  const app = setup();
  t.after(() => app.close());
  let res = await app.inject({ method: 'POST', url: '/api/crypto/flows', payload: { type: 'deposit', asset: 'usdt', amount: 250, executedAt: '2026-10-01T09:00' } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().value_usdt, 250);
  res = await app.inject({ method: 'PUT', url: '/api/crypto/invested-opening', payload: { amount: 1000 } });
  assert.equal(res.json().amount, 1000);
  const h = (await app.inject('/api/crypto/holdings')).json();
  assert.deepEqual([h.total, h.invested, h.performance], [250, 1250, -1000]);
  assert.equal((await app.inject('/api/crypto/flows')).json().length, 1);
  assert.equal((await app.inject('/api/cedears/growth?currency=USD')).json().currency, 'USD');
});

test('the growth chart ends at the same value and performance as the summary', async (t) => {
  const fx = { get: () => ({ rate: 1500 }), history: () => [] };
  const { app } = buildApp({ db: openDb(':memory:'), cryptoPrices: mockCryptoProvider, marketPrices: mockMarketProvider, fx });
  t.after(() => app.close());
  await app.inject({ method: 'POST', url: '/api/crypto/flows', payload: { type: 'deposit', asset: 'BTC', amount: 0.01, executedAt: '2026-10-01T09:00' } });
  await app.inject({ method: 'POST', url: '/api/cedears/cash-movements', payload: { type: 'deposit', currency: 'USD', amount: 1000, date: '2026-10-01' } });
  await app.inject({ method: 'POST', url: '/api/cedears/operations', payload: { type: 'buy', ticker: 'SPY', quantity: 1, price: 700, currency: 'USD', date: '2026-10-01' } });

  const h = (await app.inject('/api/crypto/holdings')).json();
  const last = (await app.inject('/api/crypto/growth?currency=USD')).json().points.at(-1);
  assert.equal(last.value, h.total);
  assert.equal(last.value - last.invested, h.performance);

  const p = (await app.inject('/api/cedears/portfolio')).json();
  const g = (await app.inject('/api/cedears/growth?currency=USD')).json().points.at(-1);
  assert.equal(g.value, p.totals.USD.total);
  assert.equal(g.invested, p.totals.USD.invested);
});
