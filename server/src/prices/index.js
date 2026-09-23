// ─────────────────────────────────────────────────────────────────────────────
// PUNTO DE INTEGRACIÓN DE PRECIOS
//
// Todo el resto de la app obtiene precios únicamente a través de este módulo.
// Cada fuente tiene un proveedor (adapter) intercambiable por variable de
// entorno y, delante, un caché con respaldo en la base (./cache.js): si la API
// falla se sigue mostrando el último valor válido con la fecha desde la que
// está desactualizado. Cada fuente falla por separado.
//
// Una cotización (Quote) es:
//   { price: number, previousClose: number | null }
//     price          precio actual de 1 unidad
//     previousClose  cierre del día anterior (o precio de hace 24 h en cripto);
//                    se usa para la variación del día. null = sin dato.
//
// Contrato — proveedor cripto (CRYPTO_PRICE_PROVIDER):
//   id, name: string · mock: boolean (true → la UI avisa "precios simulados")
//   getQuotes(assets: string[])     → Promise<{ [asset]: Quote | null }>  en USDT
//   getIntraday(asset)              → Promise<{ currency, points: [{ t, value }] } | null>
//     null = la API no tiene ese activo (no rompe nada). Tirar un error = API caída.
//
// Contrato — proveedor CEDEARs/ETF (MARKET_PRICE_PROVIDER):
//   id, name, mock                  igual que arriba
//   getQuotes(items: { ticker, currency, avgPrice }[])
//                                   → Promise<{ [ticker]: (Quote & { currency }) | null }>
//     currency = moneda en la que viene el precio (si difiere de la de la
//     posición se convierte con el dólar MEP). avgPrice es sólo para el mock.
//   getIntraday(ticker)             → Promise<{ currency, previousClose, points, session: { start, end } } | null>
//
// Contrato — proveedor dólar MEP (FX_PROVIDER):
//   id, name, mock
//   getMep()                        → Promise<{ buy, sell, updatedAt }>
// ─────────────────────────────────────────────────────────────────────────────
import { config } from '../config.js';
import { createQuoteCache, maxAge } from './cache.js';
import { isMarketOpen, lastSettledClose } from './market-hours.js';
import { mockCryptoProvider } from './mock-crypto.js';
import { mockMarketProvider } from './mock-market.js';
import { binanceProvider } from './binance.js';
import { yahooProvider } from './yahoo.js';
import { dolarApiProvider, mockFxProvider } from './dolarapi.js';

const CRYPTO_PROVIDERS = { binance: binanceProvider, mock: mockCryptoProvider };
const MARKET_PROVIDERS = { yahoo: yahooProvider, mock: mockMarketProvider };
const FX_PROVIDERS = { dolarapi: dolarApiProvider, mock: mockFxProvider };

function pick(registry, name, kind) {
  const provider = registry[name];
  if (!provider) {
    throw new Error(`Proveedor de precios ${kind} desconocido: "${name}". Opciones: ${Object.keys(registry).join(', ')}`);
  }
  return provider;
}

export const getCryptoPriceProvider = (name = config.cryptoPriceProvider) => pick(CRYPTO_PROVIDERS, name, 'cripto');
export const getMarketPriceProvider = (name = config.marketPriceProvider) => pick(MARKET_PROVIDERS, name, 'CEDEARs/ETF');
export const getFxProvider = (name = config.fxProvider) => pick(FX_PROVIDERS, name, 'dólar');

// Cripto: live prices cached 3 minutes; charts 5 minutes.
const CRYPTO_TTL_MS = 3 * 60_000;
// CEDEARs/ETF: 5 minutes while the market is open. Closed, the last closing
// price is kept and the API is not asked again until the next session.
const MARKET_TTL_MS = 5 * 60_000;
const marketFresh = (entry, now) => now - entry.fetchedAt < MARKET_TTL_MS || (!isMarketOpen(now) && entry.fetchedAt >= lastSettledClose(now));

// Intraday charts are only kept in memory: without the API there is no chart.
function chartCache(isFresh) {
  const mem = new Map();
  return async (key, load) => {
    const hit = mem.get(key);
    if (hit && isFresh(hit, Date.now())) return hit.data;
    const data = await load();
    mem.set(key, { data, fetchedAt: Date.now() });
    return data;
  };
}

const describe = (provider) => ({ name: provider.name, mock: provider.mock });

// Price source used by the crypto service.
export function createCryptoPrices({ db, provider, log }) {
  const cache = createQuoteCache({
    db, log, source: `crypto:${provider.id}`, isFresh: maxAge(CRYPTO_TTL_MS),
    fetchQuotes: (items) => provider.getQuotes(items.map((i) => i.key)),
  });
  const charts = chartCache(maxAge(5 * 60_000));
  return {
    ...describe(provider),
    getQuotes: (assets) => cache.get(assets.map((key) => ({ key }))),
    getIntraday: (asset) => charts(asset, () => provider.getIntraday(asset)),
  };
}

// Price source used by the CEDEARs/ETF service. Keyed by ticker.
export function createMarketPrices({ db, provider, log }) {
  const cache = createQuoteCache({
    db, log, source: `market:${provider.id}`, isFresh: marketFresh,
    fetchQuotes: (items) => provider.getQuotes(items.map(({ key, ...item }) => item)),
  });
  const charts = chartCache(marketFresh);
  return {
    ...describe(provider),
    getQuotes: (items) => cache.get(items.map((i) => ({ key: i.ticker, ...i }))),
    getIntraday: (ticker) => charts(ticker, () => provider.getIntraday(ticker)),
  };
}

export { marketKey } from './keys.js';
