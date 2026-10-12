import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Available cash the owner's portfolio must show after migration v3.
const V3_CASH_TARGET = { USD: 12890, ARS: 14814550 };

// Each entry runs once, in order: an SQL string or a function(db). Never edit
// a migration that already shipped: append a new one instead.
export const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- ── Cripto ─────────────────────────────────────────────
  CREATE TABLE crypto_holdings (
    asset      TEXT PRIMARY KEY,
    amount     REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE crypto_exchanges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    executed_at TEXT NOT NULL,
    from_asset  TEXT NOT NULL,
    from_amount REAL NOT NULL CHECK (from_amount > 0),
    to_asset    TEXT NOT NULL,
    to_amount   REAL NOT NULL CHECK (to_amount > 0),
    fee_asset   TEXT,
    fee_amount  REAL NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_crypto_exchanges_executed_at ON crypto_exchanges (executed_at);

  -- ── CEDEARs / ETF ──────────────────────────────────────
  CREATE TABLE cedear_operations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
    ticker     TEXT NOT NULL,
    quantity   REAL NOT NULL CHECK (quantity > 0),
    price      REAL NOT NULL CHECK (price >= 0),
    currency   TEXT NOT NULL CHECK (currency IN ('USD', 'ARS')),
    commission REAL NOT NULL DEFAULT 0 CHECK (commission >= 0),
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_cedear_operations_date ON cedear_operations (date, id);

  CREATE TABLE cedear_cash_movements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
    currency   TEXT NOT NULL CHECK (currency IN ('USD', 'ARS')),
    amount     REAL NOT NULL CHECK (amount > 0),
    date       TEXT NOT NULL,
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- ── Snapshots diarios (una fila por cartera y día) ─────
  CREATE TABLE snapshots (
    portfolio TEXT NOT NULL CHECK (portfolio IN ('crypto', 'cedears')),
    date      TEXT NOT NULL,
    value     REAL NOT NULL,
    currency  TEXT NOT NULL,
    PRIMARY KEY (portfolio, date)
  );
  `,
  // v2: CEDEARs/ETF are tracked per currency (ARS and USD, no exchange rate),
  // so a portfolio can have one snapshot per currency and day. The old CEDEAR
  // snapshots were consolidated into USD with an exchange rate and are not
  // comparable anymore, so they are dropped (today's is recaptured on start).
  `
  CREATE TABLE snapshots_v2 (
    portfolio TEXT NOT NULL CHECK (portfolio IN ('crypto', 'cedears')),
    date      TEXT NOT NULL,
    currency  TEXT NOT NULL,
    value     REAL NOT NULL,
    PRIMARY KEY (portfolio, date, currency)
  );
  INSERT INTO snapshots_v2 (portfolio, date, currency, value)
    SELECT portfolio, date, currency, value FROM snapshots WHERE portfolio = 'crypto';
  DROP TABLE snapshots;
  ALTER TABLE snapshots_v2 RENAME TO snapshots;
  `,
  // v3 (one-time data fix): the deposits and withdrawals loaded while testing
  // left the available cash wrong (even negative). They are removed from the
  // history and the available cash is set to its real value through an
  // opening balance per currency, so buys and sells still move it from there.
  // Operations and positions are not touched. Skipped on an empty database.
  (db) => {
    const hasData = db.prepare(
      'SELECT EXISTS (SELECT 1 FROM cedear_operations) OR EXISTS (SELECT 1 FROM cedear_cash_movements) AS yes',
    ).get().yes;
    if (!hasData) return;
    const fromOperations = Object.fromEntries(
      db.prepare(`
        SELECT currency, SUM(CASE type WHEN 'buy' THEN -(quantity * price + commission)
                                       ELSE quantity * price - commission END) AS delta
        FROM cedear_operations GROUP BY currency`).all().map((r) => [r.currency, r.delta]),
    );
    for (const [currency, target] of Object.entries(V3_CASH_TARGET)) {
      setSetting(db, `cedears_opening_cash_${currency}`, target - (fromOperations[currency] ?? 0));
    }
    db.exec('DELETE FROM cedear_cash_movements');
  },
  // v4: last valid price of every source (crypto, CEDEARs/ETF, dólar MEP), so
  // the app can keep showing it while an API is down (see prices/cache.js).
  `
  CREATE TABLE price_cache (
    source     TEXT NOT NULL,
    key        TEXT NOT NULL,
    data       TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (source, key)
  );
  `,
  // v5: invested money vs. market performance.
  // - crypto_flows: money put into (or taken out of) crypto, valued in USDT
  //   when it happened. Exchanges between coins and balance corrections are
  //   not flows.
  // - fx_rates: dólar MEP of each day, to convert the history.
  // - Crypto had no record of contributions: what was invested so far starts
  //   as the value of the first snapshot (editable in the app).
  (db) => {
    db.exec(`
      CREATE TABLE crypto_flows (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        executed_at TEXT NOT NULL,
        asset       TEXT NOT NULL,
        amount      REAL NOT NULL CHECK (amount <> 0),
        value_usdt  REAL NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX idx_crypto_flows_executed_at ON crypto_flows (executed_at);

      CREATE TABLE fx_rates (
        date TEXT PRIMARY KEY,
        rate REAL NOT NULL CHECK (rate > 0)
      );
      INSERT INTO fx_rates (date, rate)
        SELECT substr(fetched_at, 1, 10), json_extract(data, '$.sell') FROM price_cache
        WHERE source LIKE 'fx:%' AND source <> 'fx:mock' AND json_extract(data, '$.sell') > 0;
    `);
    const hasCrypto = db.prepare('SELECT EXISTS (SELECT 1 FROM crypto_holdings WHERE amount > 0) AS yes').get().yes;
    const first = db.prepare("SELECT date, value FROM snapshots WHERE portfolio = 'crypto' ORDER BY date LIMIT 1").get();
    if (hasCrypto && first) {
      setSetting(db, 'crypto_invested_opening', first.value);
      setSetting(db, 'crypto_invested_opening_date', first.date);
    }
  },
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      const m = MIGRATIONS[v];
      if (typeof m === 'function') m(db);
      else db.exec(m);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

export function setSetting(db, key, value) {
  if (value === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ).run(key, String(value));
  }
}
