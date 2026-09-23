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

// sources: { crypto: { snapshotValue() }, cedears: { snapshotValue() } }
export function createSnapshotService(db, sources, log = console) {
  const q = {
    upsert: db.prepare(`
      INSERT INTO snapshots (portfolio, date, value, currency) VALUES (?, ?, ?, ?)
      ON CONFLICT (portfolio, date) DO UPDATE SET value = excluded.value, currency = excluded.currency`),
    series: db.prepare('SELECT date, value, currency FROM snapshots WHERE portfolio = ? ORDER BY date'),
  };

  // Records (or refreshes) today's snapshot. Running it many times a day is
  // fine: the day keeps the latest value, i.e. its closing value.
  async function capture(portfolio, date = localDate()) {
    try {
      const result = await sources[portfolio].snapshotValue();
      if (!result) return null;
      q.upsert.run(portfolio, date, result.value, result.currency);
      return result;
    } catch (err) {
      log.warn(`[snapshots] no se pudo guardar el snapshot de ${portfolio}: ${err.message}`);
      return null;
    }
  }

  return {
    capture,

    async captureAll() {
      for (const p of PORTFOLIOS) await capture(p);
    },

    getGrowth(portfolio) {
      const points = q.series.all(portfolio);
      const series = {};
      const available = [];
      for (const view of Object.keys(VIEWS)) {
        series[view] = aggregate(points, view).map(({ date, value }) => ({ date, value }));
        // Daily is always offered; the others appear once they have 2+ periods.
        if (view === 'daily' ? series[view].length > 0 : series[view].length >= 2) available.push(view);
      }
      return { currency: points.at(-1)?.currency ?? null, available, series };
    },
  };
}
