import { clean } from '../lib/num.js';
import { convert, rateLookup } from '../lib/fx-history.js';
import { investedOf } from '../cedears/service.js';

// Growth chart data: one point per daily snapshot with the portfolio value
// and the money invested up to that day, in the currency asked for (each day
// converted with that day's dólar MEP), plus every deposit/withdrawal so the
// chart can flag them. Performance at any point is value − invested.
//
// → { currency, points: [{ date, value, invested }], flows: [{ date, amount }], missingRate }
//   missingRate: some days could not be converted (no dólar MEP known yet).
export function createGrowthService(db, { crypto, cedears, fx }) {
  const q = { series: db.prepare('SELECT date, currency, value FROM snapshots WHERE portfolio = ? ORDER BY date') };
  const rates = () => rateLookup(fx.history(), fx.get()?.rate ?? null);

  // Same-day flows are shown as one flag.
  function mergeFlows(list) {
    const byDate = new Map();
    for (const { date, amount } of list) byDate.set(date, (byDate.get(date) ?? 0) + amount);
    return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount: clean(amount) }));
  }

  function cryptoGrowth(currency) {
    const rateOn = rates();
    const flows = crypto
      .listFlows()
      .map((f) => ({ date: f.executed_at.slice(0, 10), usdt: f.value_usdt }))
      .sort((a, b) => a.date.localeCompare(b.date));
    let invested = crypto.getOpening().amount;
    let next = 0;
    let missingRate = false;
    const points = [];
    for (const row of q.series.all('crypto')) {
      while (next < flows.length && flows[next].date <= row.date) invested += flows[next++].usdt;
      const rate = rateOn(row.date);
      const value = convert(row.value, 'USD', currency, rate);
      if (value === null) {
        missingRate = true;
        continue;
      }
      points.push({ date: row.date, value: clean(value), invested: clean(convert(invested, 'USD', currency, rate)) });
    }
    const converted = flows.map((f) => ({ date: f.date, amount: convert(f.usdt, 'USD', currency, rateOn(f.date)) }));
    return { currency, points, flows: mergeFlows(converted.filter((f) => f.amount !== null)), missingRate };
  }

  // CEDEARs/ETF keep one snapshot per currency: the portfolio is their sum,
  // each converted with the day's rate. Weekends have no snapshot.
  function cedearsGrowth(currency) {
    const rateOn = rates();
    const { opening, movements } = cedears.investedHistory();
    const byDate = new Map();
    for (const row of q.series.all('cedears')) {
      if (!byDate.has(row.date)) byDate.set(row.date, {});
      byDate.get(row.date)[row.currency] = row.value;
    }
    const last = {}; // latest value of each currency (a currency may skip a day)
    let missingRate = false;
    const points = [];
    for (const [date, values] of byDate) {
      Object.assign(last, values);
      const invested = investedOf(movements, opening, date);
      const rate = rateOn(date);
      let value = 0;
      let inv = 0;
      for (const c of Object.keys(last)) {
        const v = convert(last[c], c, currency, rate);
        const i = convert(invested[c], c, currency, rate);
        if (v === null || i === null) {
          value = null;
          break;
        }
        value += v;
        inv += i;
      }
      if (value === null) {
        missingRate = true;
        continue;
      }
      points.push({ date, value: clean(value), invested: clean(inv) });
    }
    const converted = movements.map((m) => ({
      date: m.date,
      amount: convert(m.type === 'deposit' ? m.amount : -m.amount, m.currency, currency, rateOn(m.date)),
    }));
    return { currency, points, flows: mergeFlows(converted.filter((f) => f.amount !== null)), missingRate };
  }

  return {
    get: (portfolio, currency) => (portfolio === 'crypto' ? cryptoGrowth(currency) : cedearsGrowth(currency)),
  };
}
