import { fetchJson } from './http.js';

// DolarAPI (dolarapi.com), free and without key. "bolsa" is the dólar MEP.
export const dolarApiProvider = {
  id: 'dolarapi',
  name: 'DolarAPI',
  mock: false,
  async getMep() {
    const d = await fetchJson('https://dolarapi.com/v1/dolares/bolsa');
    const buy = Number(d?.compra);
    const sell = Number(d?.venta);
    if (!(buy > 0) || !(sell > 0)) throw new Error('respuesta inesperada de DolarAPI');
    return { buy, sell, updatedAt: d.fechaActualizacion ?? null };
  },
};

// MOCK — fixed rate, for development without internet.
export const mockFxProvider = {
  id: 'mock',
  name: 'Simulado',
  mock: true,
  async getMep() {
    return { buy: 1440, sell: 1460, updatedAt: new Date().toISOString() };
  },
};
