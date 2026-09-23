import { dailyDrift, fakeIntraday, hash, yesterday } from './mock-util.js';

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
  async getIntraday(asset) {
    if (STABLECOINS.has(asset)) return null;
    const now = Date.now();
    return { currency: 'USDT', points: fakeIntraday(asset, now - 86400000, now, priceOf(asset)) };
  },
};
