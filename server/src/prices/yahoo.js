import { fetchJson } from './http.js';

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
      points,
      session: regular ? { start: regular.start * 1000, end: regular.end * 1000 } : null,
    };
  },
};
