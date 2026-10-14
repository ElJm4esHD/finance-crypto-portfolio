import { fetchJson } from './http.js';
import { rangeWindow, spanDays } from './ranges.js';

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

  // Daily close per UTC day between two dates (YYYY-MM-DD), for repairing
  // the history after a correction. null → Binance does not list it.
  async getDailyCloses(asset, from, to) {
    if (asset === 'USDT') return { currency: 'USDT', closes: [{ date: from, close: 1 }] };
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T23:59:59Z`);
    try {
      const klines = await fetchJson(`${BASE}/klines?symbol=${pair(asset)}&interval=1d&startTime=${start}&endTime=${end}&limit=1000`);
      return { currency: 'USDT', closes: klines.map((k) => ({ date: new Date(k[0]).toISOString().slice(0, 10), close: Number(k[4]) })) };
    } catch (err) {
      if (isUnknownSymbol(err)) return null;
      throw err;
    }
  },

  // Price over a range (see ranges.js), as candle closes: 5-minute candles
  // for a day, up to weekly ones for the whole history (≤ 1000 points).
  // null → Binance does not list it (or USDT, always 1).
  async getHistory(asset, range, dates) {
    if (asset === 'USDT') return null;
    const window = rangeWindow(range, dates);
    const days = spanDays(window);
    const interval = days <= 1.5 ? '5m' : days <= 7 ? '30m' : days <= 45 ? '4h' : days <= 1000 ? '1d' : '1w';
    const span = window.start === null ? '' : `&startTime=${window.start}&endTime=${window.end}`;
    try {
      const klines = await fetchJson(`${BASE}/klines?symbol=${pair(asset)}&interval=${interval}&limit=1000${span}`);
      const now = Date.now();
      return { currency: 'USDT', points: klines.map((k) => ({ t: Math.min(k[6] + 1, now), value: Number(k[4]) })) };
    } catch (err) {
      if (isUnknownSymbol(err)) return null;
      throw err;
    }
  },

  // Last 24 h in 5-minute candles (sparklines and the 1D chart).
  getIntraday(asset) {
    return this.getHistory(asset, '1D');
  },
};
