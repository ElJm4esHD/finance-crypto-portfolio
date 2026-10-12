import { clean } from '../lib/num.js';
import { localDate } from '../lib/dates.js';
import { convert, rateLookup } from '../lib/fx-history.js';

// Corrections ("Editar") change data as if it had always been that way, so
// the daily snapshots already recorded must change too. A correction is
// described as the difference it makes to the past, as a list of terms; every
// snapshot of date d gets, for each term with d >= from (or from = null):
//
//   { kind: 'cash',  currency, from, amount }
//       + amount (CEDEARs/ETF available cash in that currency)
//   { kind: 'asset', symbol, currency, from, amount, fallback? }
//       + amount × close of `symbol` on d, converted to `currency`
//         (fallback = price to use if the symbol has no history)
//
// Only the difference is applied, so everything else in the old snapshots is
// left as it was. Cash terms are applied right away, inside the correction's
// transaction. Asset terms need past prices: they are queued in
// snapshot_repairs and applied as soon as the price API answers (retried on
// start and every hour). Today is never touched: it is recaptured live.
//
// closes: { crypto(symbol, from, to), cedears(symbol, from, to) }
//   → { currency, closes: [{ date, close }] } | null
export function createSnapshotRepairs(db, { closes, fx = null, log = console }) {
  const q = {
    dates: db.prepare('SELECT DISTINCT date FROM snapshots WHERE portfolio = ? AND date < ? ORDER BY date'),
    row: db.prepare('SELECT value FROM snapshots WHERE portfolio = ? AND date = ? AND currency = ?'),
    insert: db.prepare('INSERT INTO snapshots (portfolio, date, currency, value) VALUES (?, ?, ?, ?)'),
    update: db.prepare('UPDATE snapshots SET value = ? WHERE portfolio = ? AND date = ? AND currency = ?'),
    queue: db.prepare('INSERT INTO snapshot_repairs (portfolio, terms) VALUES (?, ?)'),
    pending: db.prepare('SELECT * FROM snapshot_repairs ORDER BY id'),
    done: db.prepare('DELETE FROM snapshot_repairs WHERE id = ?'),
  };
  let running = null;

  // Adds the terms to every past snapshot. prices: symbol → { currency, closes } | null.
  function apply(portfolio, terms, prices = {}) {
    const dates = q.dates.all(portfolio, localDate()).map((r) => r.date);
    if (dates.length === 0 || terms.length === 0) return;
    const rateOn = rateLookup(fx?.history() ?? [], fx?.get()?.rate ?? null);
    const priceOn = (term, date) => {
      const series = prices[term.symbol];
      if (!series || series.closes.length === 0) return term.fallback ?? 0;
      let close = series.closes[0].close;
      for (const c of series.closes) {
        if (c.date > date) break;
        close = c.close;
      }
      return convert(close, series.currency ?? term.currency, term.currency, rateOn(date)) ?? term.fallback ?? 0;
    };

    for (const date of dates) {
      const add = new Map(); // currency → amount
      for (const t of terms) {
        if (t.from && date < t.from) continue;
        const amount = t.kind === 'cash' ? t.amount : t.amount * priceOn(t, date);
        add.set(t.currency, (add.get(t.currency) ?? 0) + amount);
      }
      for (const [currency, amount] of add) {
        if (Math.abs(amount) < 1e-9) continue;
        const row = q.row.get(portfolio, date, currency);
        if (row) q.update.run(clean(row.value + amount), portfolio, date, currency);
        else q.insert.run(portfolio, date, currency, clean(amount));
      }
    }
  }

  // Terms that cancel out (e.g. renaming keeps the cash) are dropped.
  function merge(terms) {
    const byKey = new Map();
    for (const t of terms) {
      const key = JSON.stringify([t.kind, t.symbol ?? null, t.currency, t.from ?? null, t.fallback ?? null]);
      const prev = byKey.get(key);
      byKey.set(key, prev ? { ...prev, amount: prev.amount + t.amount } : { ...t });
    }
    return [...byKey.values()].filter((t) => Math.abs(t.amount) > 1e-12);
  }

  async function run() {
    for (const repair of q.pending.all()) {
      const terms = JSON.parse(repair.terms);
      const today = localDate();
      const prices = {};
      for (const symbol of new Set(terms.map((t) => t.symbol))) {
        const from = terms.filter((t) => t.symbol === symbol).reduce((m, t) => (t.from && t.from < m ? t.from : m), firstDate(repair.portfolio) ?? today);
        prices[symbol] = await closes[repair.portfolio](symbol, from, today); // throws → retried later
      }
      db.transaction(() => {
        apply(repair.portfolio, terms, prices);
        q.done.run(repair.id);
      })();
      log.info?.(`[snapshots] historial de ${repair.portfolio} corregido`);
    }
  }

  const firstDate = (portfolio) => q.dates.all(portfolio, localDate())[0]?.date ?? null;

  return {
    // Call inside the correction's transaction.
    enqueue(portfolio, terms) {
      const merged = merge(terms);
      apply(
        portfolio,
        merged.filter((t) => t.kind === 'cash'),
      );
      const assets = merged.filter((t) => t.kind === 'asset');
      if (assets.length) q.queue.run(portfolio, JSON.stringify(assets));
    },

    // Applies the queued repairs; safe to call often. → true when none is left.
    async process() {
      if (!running) {
        running = run()
          .catch((err) => log.warn(`[snapshots] no se pudo corregir el historial todavía: ${err.message}`))
          .finally(() => {
            running = null;
          });
      }
      await running;
      return q.pending.all().length === 0;
    },

    pending: () => q.pending.all().length,
  };
}

// Used by services built without repairs (tests, scripts).
export const NO_REPAIRS = { enqueue() {}, process: async () => true, pending: () => 0 };
