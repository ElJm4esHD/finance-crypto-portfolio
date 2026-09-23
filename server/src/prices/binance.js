// TODO(precios): integración real con Binance — PENDIENTE.
//
// Implementación sugerida:
//   GET https://api.binance.com/api/v3/ticker/24hr?type=MINI  (sin API key, un solo request)
//   → [{ symbol: "BTCUSDT", lastPrice: "95000.12", openPrice: "94100.00", ... }, ...]
//   Para cada asset:
//     USDT / stablecoins        → { price: 1, previousClose: 1 }
//     existe `${asset}USDT`     → { price: lastPrice, previousClose: openPrice }  (openPrice = hace 24 h)
//     si no                     → null (la app lo muestra como "sin precio")
//   Conviene cachear la respuesta ~60 s para no pegarle en cada request de la UI.
//
// Una vez implementado: CRYPTO_PRICE_PROVIDER=binance en docker-compose.yml.
export const binanceProvider = {
  name: 'Binance',
  mock: false,
  async getQuotes() {
    throw new Error('Integración con Binance todavía no implementada (server/src/prices/binance.js)');
  },
};
