// ─────────────────────────────────────────────────────────────────────────────
// PUNTO DE INTEGRACIÓN DE PRECIOS DE MERCADO
//
// Todo el resto de la app obtiene precios únicamente a través de este módulo.
// Para conectar una API real alcanza con implementar el contrato de abajo en
// un archivo nuevo, registrarlo en PROVIDERS y elegirlo por variable de entorno
// (CRYPTO_PRICE_PROVIDER / MARKET_PRICE_PROVIDER). Nada más cambia.
//
// Una cotización (Quote) es:
//   { price: number, previousClose: number | null }
//     price          precio actual de 1 unidad
//     previousClose  precio de cierre del día anterior (o de hace 24 h en cripto);
//                    se usa para la variación del día. null = sin dato.
//
// Contrato — proveedor cripto:
//   name: string                       nombre visible en la UI
//   mock: boolean                      true → la UI avisa "precios simulados"
//   getQuotes(assets: string[])        → Promise<{ [asset]: Quote | null }>
//     Precios expresados en USDT. null = sin precio para ese activo
//     (no se valúa, no rompe nada).
//
// Contrato — proveedor CEDEARs/ETF:
//   name, mock                         igual que arriba
//   getQuotes(items: { ticker, currency, avgPrice }[])
//                                      → Promise<{ [`${ticker}|${currency}`]: Quote | null }>
//     Precios en la moneda de la posición (ej. AAPL.BA en ARS).
//     avgPrice (precio promedio de compra) es sólo una pista para el mock;
//     un proveedor real lo ignora.
// ─────────────────────────────────────────────────────────────────────────────
import { config } from '../config.js';
import { mockCryptoProvider } from './mock-crypto.js';
import { mockMarketProvider } from './mock-market.js';
import { binanceProvider } from './binance.js';
import { realMarketProvider } from './market.js';

const CRYPTO_PROVIDERS = {
  mock: mockCryptoProvider,
  binance: binanceProvider, // TODO(precios): implementar en ./binance.js
};

const MARKET_PROVIDERS = {
  mock: mockMarketProvider,
  real: realMarketProvider, // TODO(precios): implementar en ./market.js
};

function pick(registry, name, kind) {
  const provider = registry[name];
  if (!provider) {
    throw new Error(`Proveedor de precios ${kind} desconocido: "${name}". Opciones: ${Object.keys(registry).join(', ')}`);
  }
  return provider;
}

export function getCryptoPriceProvider(name = config.cryptoPriceProvider) {
  return pick(CRYPTO_PROVIDERS, name, 'cripto');
}

export function getMarketPriceProvider(name = config.marketPriceProvider) {
  return pick(MARKET_PROVIDERS, name, 'CEDEARs/ETF');
}

export { marketKey } from './keys.js';
