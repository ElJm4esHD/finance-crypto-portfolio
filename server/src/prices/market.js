// TODO(precios): integración real para CEDEARs / ETF — PENDIENTE.
//
// Debe devolver el precio actual de cada ticker en la moneda de la posición
// (ej. AAPL.BA en ARS) y el tipo de cambio USD→ARS usado para consolidar.
// Ver el contrato completo en ./index.js.
//
// Una vez implementado: MARKET_PRICE_PROVIDER=real en docker-compose.yml.
export const realMarketProvider = {
  name: 'Mercado',
  mock: false,
  async getPrices() {
    throw new Error('Integración de precios CEDEARs/ETF todavía no implementada (server/src/prices/market.js)');
  },
  async getUsdArsRate() {
    throw new Error('Integración de tipo de cambio todavía no implementada (server/src/prices/market.js)');
  },
};
