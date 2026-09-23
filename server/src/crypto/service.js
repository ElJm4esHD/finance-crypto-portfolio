import { getSetting, setSetting } from '../db.js';
import { UserError, NotFoundError } from '../lib/errors.js';
import { fmt } from '../lib/format.js';
import { clean, isNegative, EPSILON } from '../lib/num.js';
import { dayChangeSummary } from '../lib/day-change.js';
import { toDateTime, toNumber, toTicker } from '../lib/validate.js';

const GOAL_KEY = 'crypto_goal_usdt';

export function createCryptoService(db, priceProvider) {
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

  function getGoal() {
    const raw = getSetting(db, GOAL_KEY);
    return raw === null ? null : Number(raw);
  }

  async function fetchQuotes(assets) {
    if (assets.length === 0) return { quotes: {}, error: null };
    try {
      return { quotes: await priceProvider.getQuotes(assets), error: null };
    } catch (err) {
      return { quotes: {}, error: err.message };
    }
  }

  return {
    async getHoldings() {
      const rows = q.holdings.all();
      const { quotes, error } = await fetchQuotes(rows.filter((r) => r.amount > 0).map((r) => r.asset));
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
        goal: getGoal(),
        priceSource: { name: priceProvider.name, mock: priceProvider.mock, error },
      };
    },

    setHolding(assetInput, amountInput) {
      const asset = toTicker(assetInput, 'la moneda');
      const amount = toNumber(amountInput, 'La cantidad', { allowMin: true });
      q.upsertHolding.run(asset, amount);
      return q.holding.get(asset);
    },

    deleteHolding(assetInput) {
      const asset = toTicker(assetInput, 'la moneda');
      if (q.deleteHolding.run(asset).changes === 0) throw new NotFoundError(`No existe la moneda ${asset}.`);
    },

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
