// Dólar MEP used for every ARS ↔ USD conversion in the app. It is fetched
// once a day by the scheduler (see index.js), never on demand: every screen
// reads the stored value. If the fetch fails the last value keeps being used
// and flagged as outdated.
const KEY = 'MEP';

export function createFxService({ db, provider, log = console }) {
  const source = `fx:${provider.id}`;
  const q = {
    get: db.prepare('SELECT data, fetched_at FROM price_cache WHERE source = ? AND key = ?'),
    upsert: db.prepare(`
      INSERT INTO price_cache (source, key, data, fetched_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (source, key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`),
  };
  let failure = null;

  function stored() {
    const row = q.get.get(source, KEY);
    return row ? { ...JSON.parse(row.data), fetchedAt: row.fetched_at } : null;
  }

  return {
    // { rate, buy, sell, updatedAt, fetchedAt, name, mock, stale } | null.
    // rate is the selling price, used for conversions.
    get() {
      const mep = stored();
      if (!mep) return null;
      return {
        rate: mep.sell,
        buy: mep.buy,
        sell: mep.sell,
        updatedAt: mep.updatedAt ?? mep.fetchedAt,
        fetchedAt: mep.fetchedAt,
        name: provider.name,
        mock: provider.mock,
        stale: failure ? { since: mep.updatedAt ?? mep.fetchedAt } : null,
      };
    },

    // → true when a new value was saved.
    async refresh() {
      try {
        const mep = await provider.getMep();
        q.upsert.run(source, KEY, JSON.stringify(mep), new Date().toISOString());
        failure = null;
        log.info?.(`[dólar] MEP ${mep.sell} (${provider.name})`);
        return true;
      } catch (err) {
        failure = { at: Date.now(), message: err.message };
        log.warn(`[dólar] no se pudo actualizar el MEP: ${err.message}`);
        return false;
      }
    },

    // True when the stored value is older than `since` (Date) or missing.
    isOlderThan(since) {
      const mep = stored();
      return !mep || Date.parse(mep.fetchedAt) < since.getTime();
    },
  };
}
