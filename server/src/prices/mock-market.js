import { dailyDrift, hash, yesterday } from './mock-util.js';
import { marketKey } from './keys.js';

// MOCK — cotizaciones inventadas alrededor del precio promedio de compra, para
// que valuación, rendimiento y variación del día se vean en la UI.
// Reemplazar por ./market.js.
export const mockMarketProvider = {
  name: 'Simulado',
  mock: true,
  async getQuotes(items) {
    const out = {};
    for (const { ticker, currency, avgPrice } of items) {
      const base = avgPrice > 0 ? avgPrice : (currency === 'ARS' ? 5000 : 50) * (0.5 + hash(ticker));
      const seed = `${ticker}|${currency}`;
      out[marketKey(ticker, currency)] = {
        price: base * dailyDrift(seed),
        previousClose: base * dailyDrift(seed, yesterday()),
      };
    }
    return out;
  },
};
