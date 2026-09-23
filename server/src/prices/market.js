// TODO(precios): integración real para CEDEARs / ETF — PENDIENTE.
//
// Debe devolver, para cada ticker, el precio actual y el cierre del día
// anterior en la moneda de la posición (ej. AAPL.BA en ARS).
// Ver el contrato completo en ./index.js.
//
// Una vez implementado: MARKET_PRICE_PROVIDER=real en docker-compose.yml.
export const realMarketProvider = {
  name: 'Mercado',
  mock: false,
  async getQuotes() {
    throw new Error('Integración de precios CEDEARs/ETF todavía no implementada (server/src/prices/market.js)');
  },
};
