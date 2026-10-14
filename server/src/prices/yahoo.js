import { fetchJson } from './http.js';
import { rangeWindow, spanDays } from './ranges.js';

// Yahoo's own ranges for the presets; custom dates use period1/period2.
const PRESETS = {
  '5D': 'range=5d&interval=30m',
  '1M': 'range=1mo&interval=1d',
  '6M': 'range=6mo&interval=1d',
  YTD: 'range=ytd&interval=1d',
  '1A': 'range=1y&interval=1d',
  Todo: 'range=max&interval=1wk',
};

// ─────────────────────────────────────────────────────────────────────────────
// Yahoo Finance — endpoint NO OFICIAL (Yahoo no tiene API pública desde 2017).
// Puede cambiar o dejar de andar sin aviso. Todo lo que depende de él está en
// este archivo: para reemplazarlo, escribir otro proveedor con el mismo
// contrato (ver ./index.js), registrarlo en MARKET_PROVIDERS y elegirlo con
// MARKET_PRICE_PROVIDER. El resto de la app no cambia.
// ─────────────────────────────────────────────────────────────────────────────
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

// Ticker as typed by the user (AAPL.BA, SPY…). null → Yahoo does not know it.
async function chart(ticker, params) {
  try {
    const data = await fetchJson(`${BASE}${encodeURIComponent(ticker)}?${params}`, { headers: HEADERS });
    const result = data?.chart?.result?.[0];
    if (!result?.meta) throw new Error('respuesta inesperada de Yahoo');
    return result;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export const yahooProvider = {
  id: 'yahoo',
  name: 'Yahoo Finance',
  mock: false,

  async getQuotes(items) {
    const out = {};
    await Promise.all(
      items.map(async ({ ticker }) => {
        const result = await chart(ticker, 'range=1d&interval=1d');
        const m = result?.meta;
        out[ticker] =
          m && m.regularMarketPrice != null
            ? {
                price: m.regularMarketPrice,
                previousClose: m.chartPreviousClose ?? m.previousClose ?? null,
                currency: m.currency ?? null,
              }
            : null;
      }),
    );
    return out;
  },

  // Daily close per trading day between two dates (YYYY-MM-DD), in the
  // exchange's own calendar. null → Yahoo does not know the ticker.
  async getDailyCloses(ticker, from, to) {
    const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86400;
    const p2 = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000) + 86400;
    const result = await chart(ticker, `period1=${p1}&period2=${p2}&interval=1d`);
    if (!result) return null;
    const offset = result.meta.gmtoffset ?? 0;
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    return {
      currency: result.meta.currency ?? null,
      closes: (result.timestamp ?? [])
        .map((t, i) => ({ date: new Date((t + offset) * 1000).toISOString().slice(0, 10), close: closes[i] }))
        .filter((c) => c.close != null),
    };
  },

  // Price over a range (see ranges.js). 1D is the day's session.
  async getHistory(ticker, range, dates) {
    if (range === '1D') return this.getIntraday(ticker);
    let params = PRESETS[range];
    if (!params) {
      const window = rangeWindow(range, dates);
      const days = spanDays(window);
      const recent = Date.now() - window.start < 59 * 86400_000; // intraday bars only exist for ~60 days
      const interval = days <= 7 && recent ? '30m' : days <= 1100 ? '1d' : '1wk';
      params = `period1=${Math.floor(window.start / 1000)}&period2=${Math.floor(window.end / 1000)}&interval=${interval}`;
    }
    const result = await chart(ticker, params);
    if (!result) return null;
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    return {
      currency: result.meta.currency ?? null,
      points: (result.timestamp ?? []).map((t, i) => ({ t: t * 1000, value: closes[i] })).filter((p) => p.value != null),
    };
  },

  // Today's session (or the last one, when the market is closed) in 5-minute bars.
  async getIntraday(ticker) {
    const result = await chart(ticker, 'range=1d&interval=5m');
    if (!result) return null;
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const points = (result.timestamp ?? [])
      .map((t, i) => ({ t: t * 1000, value: closes[i] }))
      .filter((p) => p.value != null);
    const regular = result.meta.currentTradingPeriod?.regular;
    return {
      currency: result.meta.currency ?? null,
      previousClose: result.meta.chartPreviousClose ?? result.meta.previousClose ?? null,
      points,
      session: regular ? { start: regular.start * 1000, end: regular.end * 1000 } : null,
    };
  },
};
