import { dailyDrift, eachDate, fakeIntraday, hash, yesterday } from './mock-util.js';
import { rangeWindow } from './ranges.js';

// MOCK — precios inventados para poder usar la app sin API. Reemplazar por ./binance.js.
const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'BUSD', 'USDP', 'PYUSD']);

const BASE_USDT = {
  BTC: 95000, ETH: 3400, BNB: 620, SOL: 180, XRP: 0.6, ADA: 0.45, DOGE: 0.15,
  DOT: 7, AVAX: 35, MATIC: 0.7, POL: 0.7, LINK: 15, LTC: 85, TRX: 0.13, ATOM: 8,
  TON: 5.5, SHIB: 0.000022, UNI: 9, NEAR: 5, ARB: 0.9, OP: 1.8,
};

const priceOf = (asset, date) => (BASE_USDT[asset] ?? 0.05 + hash(asset) * 50) * dailyDrift(asset, date);

export const mockCryptoProvider = {
  id: 'mock',
  name: 'Simulado',
  mock: true,
  async getQuotes(assets) {
    const out = {};
    for (const asset of assets) {
      out[asset] = STABLECOINS.has(asset)
        ? { price: 1, previousClose: 1 }
        : { price: priceOf(asset), previousClose: priceOf(asset, yesterday()) };
    }
    return out;
  },
  async getDailyCloses(asset, from, to) {
    const close = (d) => (STABLECOINS.has(asset) ? 1 : priceOf(asset, new Date(`${d}T12:00:00Z`)));
    return { currency: 'USDT', closes: eachDate(from, to).map((date) => ({ date, close: close(date) })) };
  },
  async getIntraday(asset) {
    return this.getHistory(asset, '1D');
  },
  async getHistory(asset, range, dates) {
    if (STABLECOINS.has(asset)) return null;
    const { start, end } = rangeWindow(range, dates);
    const from = start ?? end - 3 * 365 * 86400000;
    if (end - from <= 2 * 86400000) return { currency: 'USDT', points: fakeIntraday(asset, from, end, priceOf(asset)) };
    const days = eachDate(new Date(from).toISOString().slice(0, 10), new Date(end).toISOString().slice(0, 10));
    return { currency: 'USDT', points: days.map((d) => ({ t: Date.parse(`${d}T12:00:00Z`), value: priceOf(asset, new Date(`${d}T12:00:00Z`)) })) };
  },
};
