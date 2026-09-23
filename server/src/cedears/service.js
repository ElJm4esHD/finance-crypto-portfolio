import { UserError, NotFoundError } from '../lib/errors.js';
import { fmt } from '../lib/format.js';
import { clean, isNegative } from '../lib/num.js';
import { oneOf, toDate, toNumber, toTicker } from '../lib/validate.js';
import { marketKey } from '../prices/keys.js';

export const CURRENCIES = ['USD', 'ARS'];

// Rebuilds positions and available cash from the full history.
// A position is identified by ticker + currency. Buys recompute the weighted
// average price; sells only lower the quantity. Closed positions stay at 0.
export function computeState(operations, cashMovements) {
  const cash = { USD: 0, ARS: 0 };
  const positions = new Map();

  for (const m of cashMovements) {
    cash[m.currency] += m.type === 'deposit' ? m.amount : -m.amount;
  }

  const ordered = [...operations].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const op of ordered) {
    const key = marketKey(op.ticker, op.currency);
    let pos = positions.get(key);
    if (!pos) {
      pos = { ticker: op.ticker, currency: op.currency, quantity: 0, avgPrice: 0 };
      positions.set(key, pos);
    }
    const gross = op.quantity * op.price;
    if (op.type === 'buy') {
      const quantity = pos.quantity + op.quantity;
      pos.avgPrice = clean((pos.quantity * pos.avgPrice + gross) / quantity);
      pos.quantity = clean(quantity);
      cash[op.currency] -= gross + op.commission;
    } else {
      pos.quantity = clean(pos.quantity - op.quantity);
      cash[op.currency] += gross - op.commission;
    }
  }

  for (const c of CURRENCIES) cash[c] = clean(cash[c]);
  return { positions, cash };
}

export function createCedearService(db, priceProvider) {
  const q = {
    operations: db.prepare('SELECT * FROM cedear_operations ORDER BY date DESC, id DESC'),
    operation: db.prepare('SELECT * FROM cedear_operations WHERE id = ?'),
    insertOperation: db.prepare(`
      INSERT INTO cedear_operations (type, ticker, quantity, price, currency, commission, date)
      VALUES (@type, @ticker, @quantity, @price, @currency, @commission, @date)`),
    deleteOperation: db.prepare('DELETE FROM cedear_operations WHERE id = ?'),
    movements: db.prepare('SELECT * FROM cedear_cash_movements ORDER BY date DESC, id DESC'),
    movement: db.prepare('SELECT * FROM cedear_cash_movements WHERE id = ?'),
    insertMovement: db.prepare(`
      INSERT INTO cedear_cash_movements (type, currency, amount, date, note)
      VALUES (@type, @currency, @amount, @date, @note)`),
    deleteMovement: db.prepare('DELETE FROM cedear_cash_movements WHERE id = ?'),
  };

  const currentState = () => computeState(q.operations.all(), q.movements.all());

  // Guard used when deleting history: the remaining history must still make sense.
  function assertConsistent(state, what) {
    for (const c of CURRENCIES) {
      if (isNegative(state.cash[c])) {
        throw new UserError(`No se puede borrar ${what}: el dinero disponible en ${c} quedaría en negativo (${fmt(state.cash[c])}).`);
      }
    }
    for (const pos of state.positions.values()) {
      if (isNegative(pos.quantity)) {
        throw new UserError(`No se puede borrar ${what}: la posición de ${pos.ticker} quedaría en negativo.`);
      }
    }
  }

  async function fetchMarket(open) {
    const result = { prices: {}, fx: null, error: null };
    try {
      result.fx = await priceProvider.getUsdArsRate();
      if (open.length > 0) {
        result.prices = await priceProvider.getPrices(
          open.map(({ ticker, currency, avgPrice }) => ({ ticker, currency, avgPrice })),
        );
      }
    } catch (err) {
      result.error = err.message;
    }
    return result;
  }

  const toUsd = (amount, currency, fx) => (currency === 'USD' ? amount : fx ? amount / fx : null);

  async function valuate() {
    const movements = q.movements.all();
    const { positions, cash } = computeState(q.operations.all(), movements);
    const all = [...positions.values()];
    const open = all.filter((p) => p.quantity > 0);
    const { prices, fx, error } = await fetchMarket(open);

    const rows = all.map((p) => {
      const price = p.quantity > 0 ? prices[marketKey(p.ticker, p.currency)] ?? null : null;
      const cost = clean(p.quantity * p.avgPrice);
      const value = price === null ? null : clean(p.quantity * price);
      return {
        ...p,
        price,
        cost,
        value,
        pnl: value === null ? null : clean(value - cost),
        pnlPct: price === null || p.avgPrice === 0 ? null : clean((price / p.avgPrice - 1) * 100),
        // Weight uses market value, or cost while there is no price.
        weightBaseUsd: toUsd(value ?? cost, p.currency, fx),
      };
    });

    const positionsUsd = rows.reduce((s, r) => s + (r.weightBaseUsd ?? 0), 0);
    for (const r of rows) {
      r.weight = positionsUsd > 0 && r.weightBaseUsd !== null ? clean((r.weightBaseUsd / positionsUsd) * 100) : null;
      delete r.weightBaseUsd;
    }
    rows.sort((a, b) => (b.quantity > 0) - (a.quantity > 0) || (b.weight ?? 0) - (a.weight ?? 0) || a.ticker.localeCompare(b.ticker));

    const cashUsd = toUsd(cash.USD, 'USD', fx) + (toUsd(cash.ARS, 'ARS', fx) ?? 0);
    return {
      positions: rows,
      cash,
      fx,
      totals: {
        positionsUsd: clean(positionsUsd),
        cashUsd: clean(cashUsd),
        totalUsd: clean(positionsUsd + cashUsd),
      },
      priceSource: { name: priceProvider.name, mock: priceProvider.mock, error },
      hasData: all.length > 0 || movements.length > 0,
    };
  }

  return {
    getPortfolio: valuate,

    listOperations() {
      return q.operations.all();
    },

    createOperation(input) {
      const op = {
        type: oneOf(input.type, ['buy', 'sell'], 'El tipo de operación'),
        ticker: toTicker(input.ticker, 'el ticker'),
        quantity: toNumber(input.quantity, 'La cantidad'),
        price: toNumber(input.price, 'El precio', { allowMin: true }),
        currency: oneOf(input.currency, CURRENCIES, 'La moneda'),
        commission: input.commission == null || input.commission === '' ? 0 : toNumber(input.commission, 'La comisión', { allowMin: true }),
        date: toDate(input.date),
      };

      return db.transaction(() => {
        const { positions, cash } = currentState();
        if (op.type === 'buy') {
          const needed = clean(op.quantity * op.price + op.commission);
          if (isNegative(cash[op.currency] - needed)) {
            throw new UserError(
              `Fondos insuficientes en ${op.currency}: tenés ${fmt(cash[op.currency])} disponibles y la compra necesita ${fmt(needed)}. ` +
              'Cargá un depósito antes de registrar la compra.',
            );
          }
        } else {
          const held = positions.get(marketKey(op.ticker, op.currency))?.quantity ?? 0;
          if (isNegative(held - op.quantity)) {
            throw new UserError(`No tenés suficientes ${op.ticker} en ${op.currency}: tenés ${fmt(held)} y querés vender ${fmt(op.quantity)}.`);
          }
          if (isNegative(cash[op.currency] + op.quantity * op.price - op.commission)) {
            throw new UserError(`La comisión supera lo que tenés disponible en ${op.currency}.`);
          }
        }
        const { lastInsertRowid } = q.insertOperation.run(op);
        return q.operation.get(lastInsertRowid);
      })();
    },

    deleteOperation(id) {
      db.transaction(() => {
        const op = q.operation.get(id);
        if (!op) throw new NotFoundError('Esa operación no existe.');
        const remaining = q.operations.all().filter((o) => o.id !== op.id);
        assertConsistent(computeState(remaining, q.movements.all()), `esta ${op.type === 'buy' ? 'compra' : 'venta'}`);
        q.deleteOperation.run(id);
      })();
    },

    listCashMovements() {
      return q.movements.all();
    },

    createCashMovement(input) {
      const m = {
        type: oneOf(input.type, ['deposit', 'withdrawal'], 'El tipo de movimiento'),
        currency: oneOf(input.currency, CURRENCIES, 'La moneda'),
        amount: toNumber(input.amount, 'El monto'),
        date: toDate(input.date),
        note: String(input.note ?? '').trim().slice(0, 200) || null,
      };
      return db.transaction(() => {
        if (m.type === 'withdrawal') {
          const { cash } = currentState();
          if (isNegative(cash[m.currency] - m.amount)) {
            throw new UserError(`No podés retirar ${fmt(m.amount)} ${m.currency}: tenés ${fmt(cash[m.currency])} disponibles.`);
          }
        }
        const { lastInsertRowid } = q.insertMovement.run(m);
        return q.movement.get(lastInsertRowid);
      })();
    },

    deleteCashMovement(id) {
      db.transaction(() => {
        const m = q.movement.get(id);
        if (!m) throw new NotFoundError('Ese movimiento no existe.');
        const remaining = q.movements.all().filter((x) => x.id !== m.id);
        assertConsistent(computeState(q.operations.all(), remaining), `este ${m.type === 'deposit' ? 'depósito' : 'retiro'}`);
        q.deleteMovement.run(id);
      })();
    },

    // Value recorded by the daily snapshot job (USD). null → nothing to record yet.
    async snapshotValue() {
      const p = await valuate();
      if (!p.hasData) return null;
      if (p.priceSource.error) throw new Error(`precios CEDEARs/ETF: ${p.priceSource.error}`);
      return { value: p.totals.totalUsd, currency: 'USD' };
    },
  };
}
