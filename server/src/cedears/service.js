import { getSetting, setSetting } from '../db.js';
import { NO_REPAIRS } from '../snapshots/repairs.js';
import { UserError, NotFoundError } from '../lib/errors.js';
import { fmt } from '../lib/format.js';
import { cents, clean, isNegative, isNegativeMoney } from '../lib/num.js';
import { dayChangeSummary, performanceSummary } from '../lib/day-change.js';
import { oneOf, toDate, toNumber, toTicker } from '../lib/validate.js';
import { createMarketPrices, marketKey } from '../prices/index.js';
import { sparklines } from '../lib/sparkline.js';

export const CURRENCIES = ['USD', 'ARS'];

// Available cash that is not explained by the history (set once when the
// deposits and withdrawals loaded while testing were cleared, see db.js v3).
export const openingCashKey = (currency) => `cedears_opening_cash_${currency}`;

// Rebuilds positions and available cash from the full history.
// A position is identified by ticker + currency. Buys recompute the weighted
// average price; sells only lower the quantity. Closed positions stay at 0.
// Cash is rounded to cents.
// Net money put in per currency: opening balance + deposits − withdrawals.
// Buys, sells and commissions only move money inside the portfolio.
export function investedOf(cashMovements, openingCash = {}, untilDate = null) {
  const invested = { USD: openingCash.USD ?? 0, ARS: openingCash.ARS ?? 0 };
  for (const m of cashMovements) {
    if (untilDate && m.date > untilDate) continue;
    invested[m.currency] += m.type === 'deposit' ? m.amount : -m.amount;
  }
  for (const c of CURRENCIES) invested[c] = cents(invested[c]);
  return invested;
}

export function computeState(operations, cashMovements, openingCash = {}) {
  const cash = { USD: openingCash.USD ?? 0, ARS: openingCash.ARS ?? 0 };
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

  for (const c of CURRENCIES) cash[c] = cents(cash[c]);
  return { positions, cash };
}

// fx: { get() → { rate } | null } — dólar MEP, only used when a price comes in
// another currency than its position (e.g. a USD ticker held in pesos).
// What an operation adds to the past snapshots (sign −1 takes it out): its
// units from its date on, and the money it moved.
function operationTerms(op, sign) {
  const gross = op.quantity * op.price;
  const units = op.type === 'buy' ? op.quantity : -op.quantity;
  const money = op.type === 'buy' ? -(gross + op.commission) : gross - op.commission;
  return [
    { kind: 'asset', symbol: op.ticker, currency: op.currency, from: op.date, amount: sign * units, fallback: op.price },
    { kind: 'cash', currency: op.currency, from: op.date, amount: sign * money },
  ];
}

// repairs: corrects past snapshots after an edit (snapshots/repairs.js).
export function createCedearService(db, priceProvider, { fx = null, log, repairs = NO_REPAIRS } = {}) {
  const prices = createMarketPrices({ db, provider: priceProvider, log });
  const q = {
    operations: db.prepare('SELECT * FROM cedear_operations ORDER BY date DESC, id DESC'),
    operation: db.prepare('SELECT * FROM cedear_operations WHERE id = ?'),
    insertOperation: db.prepare(`
      INSERT INTO cedear_operations (type, ticker, quantity, price, currency, commission, date)
      VALUES (@type, @ticker, @quantity, @price, @currency, @commission, @date)`),
    deleteOperation: db.prepare('DELETE FROM cedear_operations WHERE id = ?'),
    updateOperation: db.prepare(`
      UPDATE cedear_operations SET ticker = @ticker, quantity = @quantity, price = @price, currency = @currency,
        commission = @commission, date = @date WHERE id = @id`),
    moveOperation: db.prepare('UPDATE cedear_operations SET ticker = ?, currency = ? WHERE id = ?'),
    movements: db.prepare('SELECT * FROM cedear_cash_movements ORDER BY date DESC, id DESC'),
    movement: db.prepare('SELECT * FROM cedear_cash_movements WHERE id = ?'),
    insertMovement: db.prepare(`
      INSERT INTO cedear_cash_movements (type, currency, amount, date, note)
      VALUES (@type, @currency, @amount, @date, @note)`),
    deleteMovement: db.prepare('DELETE FROM cedear_cash_movements WHERE id = ?'),
  };

  const openingCash = () => Object.fromEntries(CURRENCIES.map((c) => [c, Number(getSetting(db, openingCashKey(c)) ?? 0)]));
  const stateOf = (operations, movements) => computeState(operations, movements, openingCash());
  const currentState = () => stateOf(q.operations.all(), q.movements.all());

  // Guard used when deleting or editing history: it must still make sense.
  function assertConsistent(state, what) {
    for (const c of CURRENCIES) {
      if (isNegativeMoney(state.cash[c])) {
        throw new UserError(`No se puede ${what}: el dinero disponible en ${c} quedaría en negativo (${fmt(state.cash[c])}).`);
      }
    }
    for (const pos of state.positions.values()) {
      if (isNegative(pos.quantity)) {
        throw new UserError(`No se puede ${what}: la posición de ${pos.ticker} quedaría en negativo.`);
      }
    }
  }

  function parseOperation(input) {
    return {
      ticker: toTicker(input.ticker, 'el ticker'),
      quantity: toNumber(input.quantity, 'La cantidad'),
      price: toNumber(input.price, 'El precio', { allowMin: true }),
      currency: oneOf(input.currency, CURRENCIES, 'La moneda'),
      commission: input.commission == null || input.commission === '' ? 0 : toNumber(input.commission, 'La comisión', { allowMin: true }),
      date: toDate(input.date),
    };
  }

  // Quote of each open position in its own currency. Prices are fetched once
  // per ticker (cached; while the market is closed, the last close is kept).
  async function fetchQuotes(open) {
    if (open.length === 0) return { quotes: {}, stale: null, error: null };
    const items = [...new Map(open.map((p) => [p.ticker, { ticker: p.ticker, currency: p.currency, avgPrice: p.avgPrice }])).values()];
    const { quotes: byTicker, stale, error } = await prices.getQuotes(items);
    const rate = fx?.get()?.rate ?? null;
    const quotes = {};
    for (const p of open) {
      quotes[marketKey(p.ticker, p.currency)] = inCurrency(byTicker[p.ticker], p.currency, rate);
    }
    return { quotes, stale, error };
  }

  // Positions valued at market price (or at cost while there is no price).
  // No exchange rate: every figure stays in its own currency, and weights are
  // the share of each position within the positions of its currency.
  async function valuate() {
    const movements = q.movements.all();
    const opening = openingCash();
    const { positions, cash } = computeState(q.operations.all(), movements, opening);
    const invested = investedOf(movements, opening);
    const all = [...positions.values()];
    const { quotes, stale, error } = await fetchQuotes(all.filter((p) => p.quantity > 0));

    const rows = all.map((p) => {
      const quote = p.quantity > 0 ? quotes[marketKey(p.ticker, p.currency)] : null;
      const price = quote?.price ?? null;
      const prev = quote?.previousClose ?? null;
      const cost = clean(p.quantity * p.avgPrice);
      const value = price === null ? null : clean(p.quantity * price);
      return {
        ...p,
        price,
        cost,
        value,
        pnl: value === null ? null : clean(value - cost),
        pnlPct: price === null || p.avgPrice === 0 ? null : clean((price / p.avgPrice - 1) * 100),
        dayChange: price !== null && prev > 0 ? clean(p.quantity * (price - prev)) : null,
        dayChangePct: price !== null && prev > 0 ? clean((price / prev - 1) * 100) : null,
      };
    });

    const totals = {};
    for (const c of CURRENCIES) {
      const inCurrency = rows.filter((r) => r.currency === c);
      const positionsValue = inCurrency.reduce((s, r) => s + (r.value ?? r.cost), 0);
      for (const r of inCurrency) {
        r.weight = positionsValue > 0 ? clean(((r.value ?? r.cost) / positionsValue) * 100) : 0;
      }
      const withDay = inCurrency.filter((r) => r.dayChange !== null);
      const total = positionsValue + cash[c];
      totals[c] = {
        positions: clean(positionsValue),
        cash: cash[c],
        total: clean(total),
        ...dayChangeSummary(total, withDay.length ? withDay.reduce((s, r) => s + r.dayChange, 0) : null),
        ...performanceSummary(total, invested[c]),
        // Shown only for currencies the user actually uses.
        used: inCurrency.length > 0 || movements.some((m) => m.currency === c) || opening[c] !== 0,
      };
    }

    rows.sort((a, b) => (b.quantity > 0) - (a.quantity > 0) || b.weight - a.weight || a.ticker.localeCompare(b.ticker));

    return {
      positions: rows,
      cash,
      totals,
      priceSource: { name: prices.name, mock: prices.mock, stale, error },
    };
  }

  // Today's session of one ticker (or the last one, with the market closed).
  async function getIntraday(tickerInput) {
    const ticker = toTicker(tickerInput, 'el ticker');
    try {
      const chart = await prices.getIntraday(ticker);
      return { ticker, ...(chart ?? { currency: null, points: [], session: null }) };
    } catch (err) {
      throw new UserError(`No se pudo obtener el gráfico de ${ticker} desde ${prices.name} (${err.message}).`, 503);
    }
  }

  return {
    getPortfolio: valuate,
    getIntraday,

    // Today's session trend of every open position, for the holdings list.
    getSparklines() {
      const { positions } = currentState();
      const open = [...positions.values()].filter((p) => p.quantity > 0);
      const items = new Map(open.map((p) => [p.ticker, { ticker: p.ticker, currency: p.currency, avgPrice: p.avgPrice }]));
      // Quotes by ticker in the ticker's own currency, as the holdings get them.
      const getQuotes = (tickers) => prices.getQuotes(tickers.map((t) => items.get(t)));
      return sparklines([...items.keys()], { getQuotes, getIntraday: prices.getIntraday });
    },

    listOperations() {
      return q.operations.all();
    },

    createOperation(input) {
      const op = { type: oneOf(input.type, ['buy', 'sell'], 'El tipo de operación'), ...parseOperation(input) };

      return db.transaction(() => {
        const { positions, cash } = currentState();
        if (op.type === 'buy') {
          const needed = cents(op.quantity * op.price + op.commission);
          if (isNegativeMoney(cash[op.currency] - needed)) {
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
          if (isNegativeMoney(cash[op.currency] + op.quantity * op.price - op.commission)) {
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
        assertConsistent(stateOf(remaining, q.movements.all()), `borrar esta ${op.type === 'buy' ? 'compra' : 'venta'}`);
        q.deleteOperation.run(id);
      })();
    },

    // ── Corrections ("Editar") ──────────────────────────────
    // They fix data that was loaded wrong, as if it had always been right:
    // no new operation or movement shows up in the history, and the past
    // snapshots are corrected (snapshots/repairs.js), so neither the growth
    // chart nor the performance shows a jump.

    // Fixes ticker, currency, quantity, price, commission or date of one
    // operation (a buy stays a buy).
    updateOperation(id, input) {
      return db.transaction(() => {
        const old = q.operation.get(id);
        if (!old) throw new NotFoundError('Esa operación no existe.');
        const op = { ...parseOperation(input), id, type: old.type };
        const others = q.operations.all().filter((o) => o.id !== id);
        assertConsistent(stateOf([...others, op], q.movements.all()), 'guardar el cambio');
        q.updateOperation.run(op);
        repairs.enqueue('cedears', [...operationTerms(old, -1), ...operationTerms(op, 1)]);
        return q.operation.get(id);
      })();
    },

    // Renames a position (e.g. SPYD that really was SPY) and/or moves it to
    // the other currency: every operation keeps its quantity, price and date.
    renamePosition(input) {
      const ticker = toTicker(input.ticker, 'el ticker');
      const currency = oneOf(input.currency, CURRENCIES, 'La moneda');
      const newTicker = toTicker(input.newTicker, 'el ticker nuevo');
      const newCurrency = oneOf(input.newCurrency ?? currency, CURRENCIES, 'La moneda nueva');
      return db.transaction(() => {
        const all = q.operations.all();
        const ops = all.filter((o) => o.ticker === ticker && o.currency === currency);
        if (ops.length === 0) throw new NotFoundError(`No hay operaciones de ${ticker} en ${currency}.`);
        const moved = ops.map((o) => ({ ...o, ticker: newTicker, currency: newCurrency }));
        const others = all.filter((o) => !(o.ticker === ticker && o.currency === currency));
        assertConsistent(stateOf([...others, ...moved], q.movements.all()), 'guardar el cambio');
        for (const o of moved) q.moveOperation.run(o.ticker, o.currency, o.id);
        repairs.enqueue('cedears', [...ops.flatMap((o) => operationTerms(o, -1)), ...moved.flatMap((o) => operationTerms(o, 1))]);
        return { ticker: newTicker, currency: newCurrency, operations: moved.length };
      })();
    },

    // Sets the available cash of each currency given to its real amount. The
    // difference goes to the opening balance: no deposit or withdrawal is
    // recorded, and since what was invested moves by the same amount, the
    // performance does not change.
    setCash(input) {
      return db.transaction(() => {
        const { cash } = currentState();
        const opening = openingCash();
        for (const c of CURRENCIES) {
          if (input?.[c] == null || input[c] === '') continue;
          const target = toNumber(input[c], `El disponible en ${c}`, { allowMin: true });
          const delta = cents(target - cash[c]);
          if (delta === 0) continue;
          setSetting(db, openingCashKey(c), clean(opening[c] + delta));
          repairs.enqueue('cedears', [{ kind: 'cash', currency: c, from: null, amount: delta }]);
        }
        return currentState().cash;
      })();
    },

    getDailyCloses: (ticker, from, to) => prices.getDailyCloses(ticker, from, to),

    listCashMovements() {
      return q.movements.all();
    },

    // For the growth chart: opening balance and every deposit/withdrawal.
    investedHistory() {
      return { opening: openingCash(), movements: q.movements.all() };
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
          if (isNegativeMoney(cash[m.currency] - m.amount)) {
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
        assertConsistent(stateOf(q.operations.all(), remaining), `borrar este ${m.type === 'deposit' ? 'depósito' : 'retiro'}`);
        q.deleteMovement.run(id);
      })();
    },

    // Values recorded by the daily snapshot job: one per currency in use
    // (positions + available cash). [] → nothing to record yet.
    async snapshotValues() {
      const p = await valuate();
      if (p.priceSource.error) throw new Error(`precios CEDEARs/ETF: ${p.priceSource.error}`);
      return CURRENCIES.filter((c) => p.totals[c].used).map((c) => ({ value: p.totals[c].total, currency: c }));
    },
  };
}

// A quote in the position's currency: converted with the dólar MEP when the
// provider prices it in the other one; without a rate there is no price.
function inCurrency(quote, currency, rate) {
  if (!quote) return null;
  if (!quote.currency || quote.currency === currency) return quote;
  const factor = quote.currency === 'USD' && currency === 'ARS' ? rate : quote.currency === 'ARS' && currency === 'USD' && rate ? 1 / rate : null;
  if (!factor) return null;
  return {
    price: clean(quote.price * factor),
    previousClose: quote.previousClose == null ? null : clean(quote.previousClose * factor),
    currency,
  };
}
