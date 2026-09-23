import { dailyDrift, fakeIntraday, hash, yesterday } from './mock-util.js';
import { SESSION } from './market-hours.js';

// MOCK — cotizaciones inventadas alrededor del precio promedio de compra, para
// que valuación, rendimiento y variación del día se vean en la UI.
// Reemplazado por ./yahoo.js con MARKET_PRICE_PROVIDER=yahoo.
const baseOf = ({ ticker, currency, avgPrice }) => (avgPrice > 0 ? avgPrice : (currency === 'ARS' ? 5000 : 50) * (0.5 + hash(ticker)));
const bases = new Map(); // ticker → { base, currency } seen in getQuotes, for the intraday chart

export const mockMarketProvider = {
  id: 'mock',
  name: 'Simulado',
  mock: true,
  async getQuotes(items) {
    const out = {};
    for (const item of items) {
      const base = baseOf(item);
      bases.set(item.ticker, { base, currency: item.currency });
      out[item.ticker] = {
        price: base * dailyDrift(item.ticker),
        previousClose: base * dailyDrift(item.ticker, yesterday()),
        currency: item.currency,
      };
    }
    return out;
  },
  async getIntraday(ticker) {
    const { base, currency } = bases.get(ticker) ?? { base: baseOf({ ticker, currency: 'USD' }), currency: 'USD' };
    const day = new Date().toISOString().slice(0, 10);
    const start = Date.parse(`${day}T${SESSION.open}:00-03:00`);
    const end = Date.parse(`${day}T${SESSION.close}:00-03:00`);
    const to = Math.min(Date.now(), end);
    return {
      currency,
      points: to > start ? fakeIntraday(ticker, start, to, base * dailyDrift(ticker)) : [],
      session: { start, end },
    };
  },
};
