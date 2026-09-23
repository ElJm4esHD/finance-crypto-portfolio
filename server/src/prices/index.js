// ─────────────────────────────────────────────────────────────────────────────
// PUNTO DE INTEGRACIÓN DE PRECIOS DE MERCADO
//
// Todo el resto de la app obtiene precios únicamente a través de este módulo.
// Para conectar una API real alcanza con implementar el contrato de abajo en
// un archivo nuevo, registrarlo en PROVIDERS y elegirlo por variable de entorno
// (CRYPTO_PRICE_PROVIDER / MARKET_PRICE_PROVIDER). Nada más cambia.
//
// Contrato — proveedor cripto:
//   name: string                       nombre visible en la UI
//   mock: boolean                      true → la UI avisa "precios simulados"
//   getUsdtPrices(assets: string[])    → Promise<{ [asset]: number | null }>
//     Precio de 1 unidad de cada activo expresado en USDT.
//     null = sin precio para ese activo (no se valúa, no rompe nada).
//
// Contrato — proveedor CEDEARs/ETF:
//   name, mock                         igual que arriba
//   getPrices(items: { ticker, currency, avgPrice }[])
//                                      → Promise<{ [`${ticker}|${currency}`]: number | null }>
//     Precio actual de 1 unidad en la moneda de la posición.
//     avgPrice (precio promedio de compra) es sólo una pista para el mock;
//     un proveedor real lo ignora.
//   getUsdArsRate()                    → Promise<number>
//     Cuántos ARS vale 1 USD, para consolidar la cartera en USD.
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
