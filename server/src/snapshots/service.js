import { localDate } from '../lib/dates.js';

const PORTFOLIOS = ['crypto', 'cedears'];

// sources: { crypto: { snapshotValues() }, cedears: { snapshotValues() } }
// snapshotValues() → [{ value, currency }], one entry per currency.
export function createSnapshotService(db, sources, log = console) {
  const q = {
    upsert: db.prepare(`
      INSERT INTO snapshots (portfolio, date, currency, value) VALUES (?, ?, ?, ?)
      ON CONFLICT (portfolio, date, currency) DO UPDATE SET value = excluded.value`),
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
  };
}
