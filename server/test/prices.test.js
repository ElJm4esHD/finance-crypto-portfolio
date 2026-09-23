import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createQuoteCache, maxAge } from '../src/prices/cache.js';
import { isMarketOpen, lastSettledClose } from '../src/prices/market-hours.js';
import { createFxService } from '../src/prices/fx.js';
import { createCedearService } from '../src/cedears/service.js';

const silent = { warn() {}, info() {} };
const art = (s) => Date.parse(`${s}-03:00`); // Argentina time

function fakeApi(prices) {
  const api = { calls: 0, down: false };
  api.fetchQuotes = async (items) => {
    api.calls++;
    if (api.down) throw new Error('HTTP 503');
    return Object.fromEntries(items.map((i) => [i.key, prices[i.key] ? { price: prices[i.key] } : null]));
  };
  return api;
}

test('fresh quotes are served from the cache without calling the API', async () => {
  const api = fakeApi({ BTC: 100 });
  const cache = createQuoteCache({ db: openDb(':memory:'), source: 't', fetchQuotes: api.fetchQuotes, isFresh: maxAge(60_000), log: silent });
  await cache.get([{ key: 'BTC' }]);
  const res = await cache.get([{ key: 'BTC' }]);
  assert.equal(api.calls, 1);
  assert.deepEqual(res, { quotes: { BTC: { price: 100 } }, stale: null, error: null });
});

test('when the API fails the last valid quote is served as stale, also after a restart', async () => {
  const db = openDb(':memory:');
  const api = fakeApi({ BTC: 100, ETH: 5 });
  const make = () => createQuoteCache({ db, source: 't', fetchQuotes: api.fetchQuotes, isFresh: maxAge(0), log: silent });
  await make().get([{ key: 'BTC' }]);
  const { fetched_at: fetchedAt } = db.prepare('SELECT fetched_at FROM price_cache').get();

  api.down = true;
  const restarted = make();
  const res = await restarted.get([{ key: 'BTC' }, { key: 'ETH' }]);
  assert.deepEqual(res.quotes, { BTC: { price: 100 }, ETH: null });
  assert.deepEqual(res.stale, { since: fetchedAt });
  assert.equal(res.error, 'HTTP 503');

  // Backoff: the dead API is not asked again right away.
  const calls = api.calls;
  assert.deepEqual((await restarted.get([{ key: 'BTC' }])).stale, { since: fetchedAt });
  assert.equal(api.calls, calls);
});

test('unknown symbols are null but do not make the source fail', async () => {
  const api = fakeApi({ BTC: 100 });
  const cache = createQuoteCache({ db: openDb(':memory:'), source: 't', fetchQuotes: api.fetchQuotes, isFresh: maxAge(60_000), log: silent });
  const res = await cache.get([{ key: 'BTC' }, { key: 'NOPE' }]);
  assert.deepEqual(res, { quotes: { BTC: { price: 100 }, NOPE: null }, stale: null, error: null });
});

test('Argentine market session: weekdays 11:00–17:00 ART', () => {
  assert.equal(isMarketOpen(art('2026-09-23T10:59')), false); // Wednesday
  assert.equal(isMarketOpen(art('2026-09-23T11:00')), true);
  assert.equal(isMarketOpen(art('2026-09-23T16:59')), true);
  assert.equal(isMarketOpen(art('2026-09-23T17:00')), false);
  assert.equal(isMarketOpen(art('2026-09-26T12:00')), false); // Saturday
  // The close becomes final 20 minutes after 17:00; weekends go back to Friday.
  assert.equal(lastSettledClose(art('2026-09-23T18:00')), art('2026-09-23T17:20'));
  assert.equal(lastSettledClose(art('2026-09-23T10:00')), art('2026-09-22T17:20'));
  assert.equal(lastSettledClose(art('2026-09-28T09:00')), art('2026-09-25T17:20')); // Monday → Friday
});

test('the dólar MEP keeps its last value and is flagged when the refresh fails', async () => {
  const db = openDb(':memory:');
  let down = false;
  const provider = {
    id: 'test', name: 'Test', mock: false,
    getMep: async () => {
      if (down) throw new Error('timeout');
      return { buy: 1400, sell: 1420, updatedAt: '2026-09-23T13:30:00.000Z' };
    },
  };
  const fx = createFxService({ db, provider, log: silent });
  assert.equal(fx.get(), null);
  assert.equal(fx.isOlderThan(new Date()), true);
  assert.equal(await fx.refresh(), true);
  assert.equal(fx.get().rate, 1420);
  assert.equal(fx.get().stale, null);
  down = true;
  assert.equal(await fx.refresh(), false);
  assert.equal(fx.get().rate, 1420);
  assert.deepEqual(fx.get().stale, { since: '2026-09-23T13:30:00.000Z' });
});

test('a price quoted in another currency is converted with the dólar MEP', async () => {
  const provider = {
    id: 'test', name: 'Test', mock: false,
    getQuotes: async (items) => Object.fromEntries(items.map((i) => [i.ticker, { price: 10, previousClose: 8, currency: 'USD' }])),
  };
  const svc = createCedearService(openDb(':memory:'), provider, { fx: { get: () => ({ rate: 1500 }) } });
  svc.createCashMovement({ type: 'deposit', currency: 'ARS', amount: 100000, date: '2026-09-01' });
  svc.createOperation({ type: 'buy', ticker: 'SPY', quantity: 2, price: 14000, currency: 'ARS', date: '2026-09-01' });
  const [pos] = (await svc.getPortfolio()).positions;
  assert.equal(pos.price, 15000);
  assert.equal(pos.value, 30000);
  assert.equal(pos.dayChangePct, 25);
});
