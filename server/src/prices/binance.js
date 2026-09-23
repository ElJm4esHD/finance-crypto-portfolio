import { fetchJson } from './http.js';

// Binance public API (no key, read only). Prices in USDT; USDT itself is 1:1.
const BASE = 'https://api.binance.com/api/v3';

const pair = (asset) => `${asset}USDT`;

// Binance answers 400 "Invalid symbol" for pairs it does not list.
const isUnknownSymbol = (err) => err.status === 400;

export const binanceProvider = {
  id: 'binance',
  name: 'Binance',
  mock: false,

  // One ticker per asset, in parallel, so an asset without a USDT pair only
  // loses its own price. /ticker/24hr (type=MINI) is /ticker/price plus the
  // price of 24 h ago, which gives the day change.
  async getQuotes(assets) {
    const out = {};
    await Promise.all(
      assets.map(async (asset) => {
        if (asset === 'USDT') {
          out[asset] = { price: 1, previousClose: 1 };
          return;
        }
        try {
          const t = await fetchJson(`${BASE}/ticker/24hr?symbol=${pair(asset)}&type=MINI`);
          out[asset] = { price: Number(t.lastPrice), previousClose: Number(t.openPrice) || null };
        } catch (err) {
          if (!isUnknownSymbol(err)) throw err;
          out[asset] = null;
        }
      }),
    );
    return out;
  },

  // Last 24 h in 5-minute candles (close price). null → no chart for it.
  async getIntraday(asset) {
    if (asset === 'USDT') return null;
    try {
      const klines = await fetchJson(`${BASE}/klines?symbol=${pair(asset)}&interval=5m&limit=288`);
      return { currency: 'USDT', points: klines.map((k) => ({ t: k[6] + 1, value: Number(k[4]) })) };
    } catch (err) {
      if (isUnknownSymbol(err)) return null;
      throw err;
    }
  },
};
