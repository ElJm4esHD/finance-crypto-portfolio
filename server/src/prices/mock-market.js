import { dailyDrift, hash } from './mock-util.js';
import { marketKey } from './keys.js';

// MOCK — cotizaciones inventadas alrededor del precio promedio de compra, para
// que valuación y rendimiento se vean en la UI. Reemplazar por ./market.js.
export const mockMarketProvider = {
  name: 'Simulado',
  mock: true,
  async getPrices(items) {
    const out = {};
    for (const { ticker, currency, avgPrice } of items) {
      const base = avgPrice > 0 ? avgPrice : (currency === 'ARS' ? 5000 : 50) * (0.5 + hash(ticker));
      out[marketKey(ticker, currency)] = base * dailyDrift(`${ticker}|${currency}`);
    }
    return out;
  },
  async getUsdArsRate() {
    return 1400 * (0.97 + 0.03 * dailyDrift('USDARS'));
  },
};
