import { localDate, isoWeekKey } from '../lib/dates.js';

const PORTFOLIOS = ['crypto', 'cedears'];

// How each chart view groups daily snapshots, and how many points it shows.
// A bucket is represented by its last snapshot (the closing value of the period).
const VIEWS = {
  daily: { key: (d) => d, limit: 90 },
  weekly: { key: isoWeekKey, limit: 104 },
  monthly: { key: (d) => d.slice(0, 7), limit: null },
  yearly: { key: (d) => d.slice(0, 4), limit: null },
};

export function aggregate(points, view) {
  const { key, limit } = VIEWS[view];
  const buckets = new Map();
  for (const p of points) buckets.set(key(p.date), p); // points are sorted, last one wins
  const out = [...buckets.values()];
  return limit ? out.slice(-limit) : out;
}

// sources: { crypto: { snapshotValues() }, cedears: { snapshotValues() } }
// snapshotValues() → [{ value, currency }], one entry per currency.
export function createSnapshotService(db, sources, log = console) {
  const q = {
    upsert: db.prepare(`
      INSERT INTO snapshots (portfolio, date, currency, value) VALUES (?, ?, ?, ?)
      ON CONFLICT (portfolio, date, currency) DO UPDATE SET value = excluded.value`),
    series: db.prepare('SELECT date, currency, value FROM snapshots WHERE portfolio = ? ORDER BY date'),
    exists: db.prepare('SELECT 1 FROM snapshots WHERE portfolio = ? AND date = ? LIMIT 1'),
  };

  // Records (or refreshes) today's snapshot. Running it many times a day is
  // fine: the day keeps the latest value, i.e. its closing value.
  async function capture(portfolio, date = localDate()) {
    try {
      const values = await sources[portfolio].snapshotValues();
      db.transaction(() => {
        for (const { value, currency } of values) q.upsert.run(portfolio, date, currency, value);
      })();
      return values;
    } catch (err) {
      log.warn(`[snapshots] no se pudo guardar el snapshot de ${portfolio}: ${err.message}`);
      return [];
    }
  }

  return {
    capture,

    has: (portfolio, date = localDate()) => Boolean(q.exists.get(portfolio, date)),

    async captureAll() {
      for (const p of PORTFOLIOS) await capture(p);
    },

    // One entry per currency with history: { currency, available, series }.
    getGrowth(portfolio) {
      const byCurrency = new Map();
      for (const row of q.series.all(portfolio)) {
        if (!byCurrency.has(row.currency)) byCurrency.set(row.currency, []);
        byCurrency.get(row.currency).push({ date: row.date, value: row.value });
      }
      const currencies = [...byCurrency].map(([currency, points]) => {
        const series = {};
        const available = [];
        for (const view of Object.keys(VIEWS)) {
          series[view] = aggregate(points, view);
          // Daily is always offered; the others appear once they have 2+ periods.
          if (view === 'daily' || series[view].length >= 2) available.push(view);
        }
        return { currency, available, series };
      });
      return { currencies };
    },
  };
}
