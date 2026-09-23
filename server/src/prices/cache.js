// Price cache shared by every source (crypto, CEDEARs/ETF, dólar MEP).
//
// - Keeps the last quote of each key in memory and serves it while it is
//   fresh (`isFresh` decides: a TTL, or "the market is closed").
// - Every valid quote is also saved in the database, so after a restart or
//   while the API is down the app keeps showing the last known value and
//   says since when (`stale.since`).
// - After a failure it waits `backoffMs` before asking the API again, so a
//   dead API does not slow down every screen.
// A source failing never affects the others: each one has its own cache.

export function createQuoteCache({ db, source, fetchQuotes, isFresh, backoffMs = 60_000, log = console }) {
  const q = {
    all: db.prepare('SELECT key, data, fetched_at FROM price_cache WHERE source = ?'),
    upsert: db.prepare(`
      INSERT INTO price_cache (source, key, data, fetched_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (source, key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`),
  };
  // key → { quote, fetchedAt (ms) }. A null quote means "the API has no price
  // for it" (unknown symbol): remembered in memory only, never persisted.
  const mem = new Map(q.all.all(source).map((r) => [r.key, { quote: JSON.parse(r.data), fetchedAt: Date.parse(r.fetched_at) }]));
  let failure = null; // { at, message }
  let inflight = null;

  const due = (items) => items.filter((i) => !(mem.has(i.key) && isFresh(mem.get(i.key), Date.now())));

  async function refresh(items) {
    const fetchedAt = Date.now();
    const quotes = await fetchQuotes(items);
    db.transaction(() => {
      for (const { key } of items) {
        const quote = quotes[key] ?? null;
        mem.set(key, { quote, fetchedAt });
        if (quote) q.upsert.run(source, key, JSON.stringify(quote), new Date(fetchedAt).toISOString());
      }
    })();
  }

  return {
    // items: [{ key, ...whatever fetchQuotes needs }]
    // → { quotes: { [key]: quote | null }, stale: { since } | null, error }
    async get(items) {
      let pending = due(items);
      if (pending.length && inflight) {
        await inflight.catch(() => {});
        pending = due(items);
      }
      let error = null;
      if (pending.length) {
        if (failure && Date.now() - failure.at < backoffMs) {
          error = failure.message;
        } else {
          inflight = refresh(pending);
          try {
            await inflight;
            failure = null;
          } catch (err) {
            failure = { at: Date.now(), message: err.message };
            error = err.message;
            log.warn(`[precios] ${source}: ${err.message}`);
          } finally {
            inflight = null;
          }
        }
      }

      const quotes = {};
      let since = null;
      const stillDue = error ? new Set(due(items).map((i) => i.key)) : new Set();
      for (const { key } of items) {
        const entry = mem.get(key);
        quotes[key] = entry?.quote ?? null;
        if (stillDue.has(key) && entry?.quote && (since === null || entry.fetchedAt < since)) since = entry.fetchedAt;
      }
      return { quotes, stale: since === null ? null : { since: new Date(since).toISOString() }, error };
    },
  };
}

// Freshness rules.
export const maxAge = (ms) => (entry, now) => now - entry.fetchedAt < ms;
