import { getSetting, setSetting } from '../db.js';
import { UserError, NotFoundError } from '../lib/errors.js';
import { fmt } from '../lib/format.js';
import { clean, isNegative, EPSILON } from '../lib/num.js';
import { dayChangeSummary, performanceSummary } from '../lib/day-change.js';
import { toDateTime, toNumber, toTicker } from '../lib/validate.js';
import { createCryptoPrices } from '../prices/index.js';
import { sparklines } from '../lib/sparkline.js';
import { NO_REPAIRS } from '../snapshots/repairs.js';

const GOAL_KEY = 'crypto_goal_usdt';
// Invested before contributions were recorded (set by migration v5 or by hand).
const OPENING_KEY = 'crypto_invested_opening';
const OPENING_DATE_KEY = 'crypto_invested_opening_date';

const day = (dateTime) => dateTime.slice(0, 10);
const asset = (symbol, from, amount) => ({ kind: 'asset', symbol, currency: 'USDT', from, amount });

// repairs: corrects past snapshots after an edit (snapshots/repairs.js).
export function createCryptoService(db, priceProvider, { log, repairs = NO_REPAIRS } = {}) {
  const prices = createCryptoPrices({ db, provider: priceProvider, log });
  const q = {
    holdings: db.prepare('SELECT asset, amount FROM crypto_holdings ORDER BY asset'),
    holding: db.prepare('SELECT asset, amount FROM crypto_holdings WHERE asset = ?'),
    upsertHolding: db.prepare(`
      INSERT INTO crypto_holdings (asset, amount) VALUES (?, ?)
      ON CONFLICT (asset) DO UPDATE SET
        amount = excluded.amount,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`),
    deleteHolding: db.prepare('DELETE FROM crypto_holdings WHERE asset = ?'),
    exchanges: db.prepare('SELECT * FROM crypto_exchanges ORDER BY executed_at DESC, id DESC'),
    exchange: db.prepare('SELECT * FROM crypto_exchanges WHERE id = ?'),
    insertExchange: db.prepare(`
      INSERT INTO crypto_exchanges (executed_at, from_asset, from_amount, to_asset, to_amount, fee_asset, fee_amount)
      VALUES (@executed_at, @from_asset, @from_amount, @to_asset, @to_amount, @fee_asset, @fee_amount)`),
    deleteExchange: db.prepare('DELETE FROM crypto_exchanges WHERE id = ?'),
    flows: db.prepare('SELECT * FROM crypto_flows ORDER BY executed_at DESC, id DESC'),
    flow: db.prepare('SELECT * FROM crypto_flows WHERE id = ?'),
    flowsTotal: db.prepare('SELECT COALESCE(SUM(value_usdt), 0) AS total FROM crypto_flows'),
    insertFlow: db.prepare(`
      INSERT INTO crypto_flows (executed_at, asset, amount, value_usdt)
      VALUES (@executed_at, @asset, @amount, @value_usdt)`),
    deleteFlow: db.prepare('DELETE FROM crypto_flows WHERE id = ?'),
    updateFlow: db.prepare('UPDATE crypto_flows SET executed_at = ?, amount = ?, value_usdt = ? WHERE id = ?'),
    updateExchange: db.prepare(`
      UPDATE crypto_exchanges SET executed_at = @executed_at, from_amount = @from_amount, to_amount = @to_amount,
        fee_asset = @fee_asset, fee_amount = @fee_amount WHERE id = @id`),
    renameInExchanges: db.prepare(`
      UPDATE crypto_exchanges SET
        from_asset = CASE from_asset WHEN @old THEN @new ELSE from_asset END,
        to_asset = CASE to_asset WHEN @old THEN @new ELSE to_asset END,
        fee_asset = CASE fee_asset WHEN @old THEN @new ELSE fee_asset END`),
    renameInFlows: db.prepare('UPDATE crypto_flows SET asset = ? WHERE asset = ?'),
  };

  // Balance changes an exchange causes, grouped by asset.
  function exchangeDeltas(ex, sign = 1) {
    const deltas = new Map();
    const add = (asset, amount) => deltas.set(asset, (deltas.get(asset) ?? 0) + sign * amount);
    add(ex.from_asset, -ex.from_amount);
    add(ex.to_asset, ex.to_amount);
    if (ex.fee_asset && ex.fee_amount > 0) add(ex.fee_asset, -ex.fee_amount);
    return deltas;
  }

  // Applies balance changes; throws (and writes nothing) if any balance would go negative.
  function applyDeltas(deltas, insufficientMessage) {
    const updates = [];
    for (const [asset, delta] of deltas) {
      const current = q.holding.get(asset)?.amount ?? 0;
      const next = clean(current + delta);
      if (isNegative(next)) throw new UserError(insufficientMessage(asset, current, -delta));
      updates.push([asset, Math.abs(next) < EPSILON ? 0 : next]);
    }
    for (const [asset, amount] of updates) q.upsertHolding.run(asset, amount);
  }

  // Balance of `symbol` on every past date, as repair terms: today's balance
  // before each later exchange or contribution (manual corrections count as
  // if they had always been that way).
  function balanceTerms(symbol) {
    const events = [
      ...q.exchanges.all().map((ex) => ({ from: day(ex.executed_at), amount: exchangeDeltas(ex).get(symbol) ?? 0 })),
      ...q.flows.all().filter((f) => f.asset === symbol).map((f) => ({ from: day(f.executed_at), amount: f.amount })),
    ].filter((e) => e.amount !== 0);
    const current = q.holding.get(symbol)?.amount ?? 0;
    const before = current - events.reduce((sum, e) => sum + e.amount, 0);
    return [asset(symbol, null, before), ...events.map((e) => asset(symbol, e.from, e.amount))];
  }

  function getOpening() {
    const raw = getSetting(db, OPENING_KEY);
    return { amount: raw === null ? 0 : Number(raw), date: getSetting(db, OPENING_DATE_KEY) };
  }

  // Net money put into crypto, in USDT.
  const getInvested = () => clean(getOpening().amount + q.flowsTotal.get().total);

  function getGoal() {
    const raw = getSetting(db, GOAL_KEY);
    return raw === null ? null : Number(raw);
  }

  // Live prices (cached a few minutes). If Binance is down, the last known
  // ones come back with `stale.since`; an asset never priced gets null.
  async function fetchQuotes(assets) {
    if (assets.length === 0) return { quotes: {}, stale: null, error: null };
    return prices.getQuotes(assets);
  }

  return {
    async getHoldings() {
      const rows = q.holdings.all();
      const { quotes, stale, error } = await fetchQuotes(rows.filter((r) => r.amount > 0).map((r) => r.asset));
      let total = 0;
      let dayChange = null;
      const holdings = rows.map((r) => {
        const quote = r.amount > 0 ? quotes[r.asset] : null;
        const price = quote?.price ?? null;
        const value = price === null ? null : clean(r.amount * price);
        if (value !== null) total += value;
        const prev = quote?.previousClose ?? null;
        const hasDay = price !== null && prev > 0;
        if (hasDay) dayChange = (dayChange ?? 0) + r.amount * (price - prev);
        return { asset: r.asset, amount: r.amount, price, value, dayChangePct: hasDay ? clean((price / prev - 1) * 100) : null };
      });
      for (const h of holdings) h.weight = h.value !== null && total > 0 ? clean((h.value / total) * 100) : null;
      holdings.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.asset.localeCompare(b.asset));
      return {
        holdings,
        total: clean(total),
        ...dayChangeSummary(total, dayChange),
        ...performanceSummary(total, getInvested()),
        goal: getGoal(),
        priceSource: { name: prices.name, mock: prices.mock, stale, error },
      };
    },

    // ── Contributions (money in / out) ──────────────────────
    // A deposit adds coins bought with new money; a withdrawal takes coins
    // out to spend them. Each one is valued in USDT at that moment (market
    // price, or the value the user paid/received), which is what counts as
    // invested. Exchanges and balance corrections are not contributions.
    listFlows() {
      return q.flows.all();
    },

    async createFlow(input) {
      const type = input.type === 'withdrawal' ? 'withdrawal' : input.type === 'deposit' ? 'deposit' : null;
      if (!type) throw new UserError('El tipo de movimiento no es válido.');
      const asset = toTicker(input.asset, 'la moneda');
      const amount = toNumber(input.amount, 'La cantidad');
      const executedAt = toDateTime(input.executedAt);
      const given = input.valueUsdt == null || String(input.valueUsdt).trim() === '' ? null : toNumber(input.valueUsdt, 'El valor en USDT');
      let value = given;
      if (value === null) {
        const { quotes } = await fetchQuotes([asset]);
        const price = asset === 'USDT' ? 1 : quotes[asset]?.price;
        if (!price) throw new UserError(`No hay precio de ${asset} para valuarlo: ingresá cuánto vale en USDT.`);
        value = clean(amount * price);
      }
      const sign = type === 'deposit' ? 1 : -1;
      return db.transaction(() => {
        applyDeltas(
          new Map([[asset, sign * amount]]),
          (a, have, need) => `No podés retirar ${fmt(need)} ${a}: tenés ${fmt(have)}.`,
        );
        const { lastInsertRowid } = q.insertFlow.run({ executed_at: executedAt, asset, amount: sign * amount, value_usdt: sign * value });
        return q.flow.get(lastInsertRowid);
      })();
    },

    // Deleting a contribution also reverts its effect on the balance.
    deleteFlow(id) {
      db.transaction(() => {
        const flow = q.flow.get(id);
        if (!flow) throw new NotFoundError('Ese movimiento no existe.');
        applyDeltas(
          new Map([[flow.asset, -flow.amount]]),
          (a, have, need) => `No se puede borrar: revertirlo necesita ${fmt(need)} ${a} y hoy tenés ${fmt(have)}.`,
        );
        q.deleteFlow.run(id);
      })();
    },

    getInvested,

    // What was invested before contributions were recorded (USDT).
    getOpening,
    setOpening(amountInput) {
      const amount = toNumber(amountInput, 'El monto invertido', { allowMin: true });
      setSetting(db, OPENING_KEY, amount);
      return getOpening();
    },

    // Last 24 h trend of every coin held, for the holdings list.
    getSparklines() {
      const assets = q.holdings.all().filter((r) => r.amount > 0 && r.asset !== 'USDT').map((r) => r.asset);
      return sparklines(assets, prices.getIntraday);
    },

    // Price of the last 24 h, for the chart of one coin.
    async getIntraday(assetInput) {
      const asset = toTicker(assetInput, 'la moneda');
      try {
        const chart = await prices.getIntraday(asset);
        return { asset, ...(chart ?? { currency: 'USDT', points: [] }) };
      } catch (err) {
        throw new UserError(`No se pudo obtener el gráfico de ${asset} desde ${prices.name} (${err.message}).`, 503);
      }
    },

    // ── Corrections ("Editar") ──────────────────────────────
    // They fix data loaded wrong as if it had always been right: nothing new
    // shows up in the history, invested only changes if a contribution is
    // corrected, and past snapshots are corrected (snapshots/repairs.js).

    // Corrects the balance of a coin (or adds one that was missing).
    setHolding(assetInput, amountInput) {
      const symbol = toTicker(assetInput, 'la moneda');
      const amount = toNumber(amountInput, 'La cantidad', { allowMin: true });
      return db.transaction(() => {
        const before = q.holding.get(symbol)?.amount ?? 0;
        q.upsertHolding.run(symbol, amount);
        repairs.enqueue('crypto', [asset(symbol, null, amount - before)]);
        return q.holding.get(symbol);
      })();
    },

    deleteHolding(assetInput) {
      const symbol = toTicker(assetInput, 'la moneda');
      db.transaction(() => {
        const before = q.holding.get(symbol)?.amount ?? 0;
        if (q.deleteHolding.run(symbol).changes === 0) throw new NotFoundError(`No existe la moneda ${symbol}.`);
        repairs.enqueue('crypto', [asset(symbol, null, -before)]);
      })();
    },

    // Renames a coin everywhere (balance, exchanges, contributions). If the
    // new name already exists, both balances are added up.
    renameAsset(assetInput, newInput) {
      const from = toTicker(assetInput, 'la moneda');
      const to = toTicker(newInput, 'la moneda nueva');
      if (from === to) return q.holding.get(from);
      return db.transaction(() => {
        const held = q.holding.get(from);
        if (!held) throw new NotFoundError(`No existe la moneda ${from}.`);
        const clash = q.exchanges.all().some(
          (ex) => (ex.from_asset === from && ex.to_asset === to) || (ex.to_asset === from && ex.from_asset === to),
        );
        if (clash) throw new UserError(`Hay intercambios entre ${from} y ${to}: no se puede unificarlas.`);
        const terms = balanceTerms(from);
        q.upsertHolding.run(to, clean((q.holding.get(to)?.amount ?? 0) + held.amount));
        q.deleteHolding.run(from);
        q.renameInExchanges.run({ old: from, new: to });
        q.renameInFlows.run(to, from);
        repairs.enqueue('crypto', [...terms.map((t) => ({ ...t, amount: -t.amount })), ...terms.map((t) => ({ ...t, symbol: to }))]);
        return q.holding.get(to);
      })();
    },

    // Fixes the amounts or the date of an exchange (the coins stay the same).
    updateExchange(id, input) {
      return db.transaction(() => {
        const old = q.exchange.get(id);
        if (!old) throw new NotFoundError('Ese intercambio no existe.');
        const ex = {
          id,
          executed_at: toDateTime(input.executedAt),
          from_amount: toNumber(input.fromAmount, 'La cantidad que entregás'),
          to_amount: toNumber(input.toAmount, 'La cantidad que recibís'),
          fee_amount: input.feeAmount == null || String(input.feeAmount).trim() === '' ? 0 : toNumber(input.feeAmount, 'La comisión', { allowMin: true }),
          fee_asset: old.fee_asset,
        };
        if (ex.fee_amount > 0 && !ex.fee_asset) ex.fee_asset = toTicker(input.feeAsset, 'la moneda de la comisión');
        if (ex.fee_amount === 0) ex.fee_asset = null;
        const full = { ...old, ...ex };
        const change = new Map(exchangeDeltas(full));
        for (const [a, d] of exchangeDeltas(old, -1)) change.set(a, (change.get(a) ?? 0) + d);
        applyDeltas(change, (a, have, need) => `No se puede guardar: ${a} quedaría en negativo (tenés ${fmt(have)}, hacen falta ${fmt(need)}).`);
        q.updateExchange.run(ex);
        repairs.enqueue('crypto', [
          ...[...exchangeDeltas(old)].map(([a, d]) => asset(a, day(old.executed_at), -d)),
          ...[...exchangeDeltas(full)].map(([a, d]) => asset(a, day(full.executed_at), d)),
        ]);
        return q.exchange.get(id);
      })();
    },

    // Fixes amount, value or date of a contribution (a deposit stays a deposit).
    updateFlow(id, input) {
      return db.transaction(() => {
        const old = q.flow.get(id);
        if (!old) throw new NotFoundError('Ese movimiento no existe.');
        const sign = old.amount > 0 ? 1 : -1;
        const amount = sign * toNumber(input.amount, 'La cantidad');
        const value = sign * toNumber(input.valueUsdt, 'El valor en USDT', { allowMin: true });
        const executedAt = toDateTime(input.executedAt);
        applyDeltas(new Map([[old.asset, amount - old.amount]]), (a, have) => `No se puede guardar: ${a} quedaría en negativo (tenés ${fmt(have)}).`);
        q.updateFlow.run(executedAt, amount, value, id);
        repairs.enqueue('crypto', [asset(old.asset, day(old.executed_at), -old.amount), asset(old.asset, day(executedAt), amount)]);
        return q.flow.get(id);
      })();
    },

    getDailyCloses: (symbol, from, to) => prices.getDailyCloses(symbol, from, to),

    listExchanges() {
      return q.exchanges.all();
    },

    createExchange(input) {
      const ex = {
        executed_at: toDateTime(input.executedAt),
        from_asset: toTicker(input.fromAsset, 'la moneda que entregás'),
        from_amount: toNumber(input.fromAmount, 'La cantidad que entregás'),
        to_asset: toTicker(input.toAsset, 'la moneda que recibís'),
        to_amount: toNumber(input.toAmount, 'La cantidad que recibís'),
        fee_asset: null,
        fee_amount: 0,
      };
      if (ex.from_asset === ex.to_asset) {
        throw new UserError('La moneda que entregás y la que recibís tienen que ser distintas.');
      }
      const hasFee = input.feeAmount != null && String(input.feeAmount).trim() !== '';
      if (hasFee) {
        ex.fee_amount = toNumber(input.feeAmount, 'La comisión', { allowMin: true });
        if (ex.fee_amount > 0) ex.fee_asset = toTicker(input.feeAsset, 'la moneda de la comisión');
      }

      return db.transaction(() => {
        applyDeltas(
          exchangeDeltas(ex),
          (asset, have, need) =>
            `No alcanza el saldo de ${asset}: tenés ${fmt(have)} y este intercambio necesita ${fmt(need)}. ` +
            'Si el saldo está mal, corregilo en Cartera.',
        );
        const { lastInsertRowid } = q.insertExchange.run(ex);
        return q.exchange.get(lastInsertRowid);
      })();
    },

    // Deleting an exchange also reverts its effect on holdings.
    deleteExchange(id) {
      db.transaction(() => {
        const ex = q.exchange.get(id);
        if (!ex) throw new NotFoundError('Ese intercambio no existe.');
        applyDeltas(
          exchangeDeltas(ex, -1),
          (asset, have, need) =>
            `No se puede borrar: revertirlo necesita ${fmt(need)} ${asset} y hoy tenés ${fmt(have)}. ` +
            'Corregí el saldo en Cartera primero.',
        );
        q.deleteExchange.run(id);
      })();
    },

    getGoal,

    setGoal(amountInput) {
      if (amountInput === null || amountInput === '') {
        setSetting(db, GOAL_KEY, null);
        return null;
      }
      const amount = toNumber(amountInput, 'El objetivo');
      setSetting(db, GOAL_KEY, amount);
      return amount;
    },

    // Values recorded by the daily snapshot job. [] → nothing to record yet.
    // Outdated prices are never recorded.
    async snapshotValues() {
      const rows = q.holdings.all().filter((r) => r.amount > 0);
      if (rows.length === 0) return [];
      const { quotes, error } = await fetchQuotes(rows.map((r) => r.asset));
      if (error) throw new Error(`precios cripto: ${error}`);
      const value = rows.reduce((sum, r) => sum + (quotes[r.asset] ? r.amount * quotes[r.asset].price : 0), 0);
      return [{ value: clean(value), currency: 'USDT' }];
    },
  };
}
