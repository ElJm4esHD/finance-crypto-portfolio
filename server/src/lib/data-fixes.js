import { getSetting, setSetting } from '../db.js';

// One-time corrections of the owner's data, applied on start with the same
// corrections the app offers in "Editar", so the past snapshots are repaired
// too and nothing new shows up in the history. Each one runs once (a settings
// flag marks it done) and only on a database that already has data.
// If one fails it is retried on the next start. Before applying any, a copy
// of the database is saved (backup(name), see index.js).
export const DATA_FIXES = [
  {
    // The position loaded as SPYD was SPY: same operations, prices and dates.
    key: 'data_fix_2026_10_spyd_is_spy',
    run({ cedears }) {
      const currencies = new Set(cedears.listOperations().filter((o) => o.ticker === 'SPYD').map((o) => o.currency));
      for (const currency of currencies) cedears.renamePosition({ ticker: 'SPYD', currency, newTicker: 'SPY' });
      return currencies.size ? 'SPYD → SPY' : 'no había SPYD';
    },
  },
  {
    // The available cash still carried test loads (~USD 20.000 + ARS 15.000.000).
    key: 'data_fix_2026_10_real_cash',
    run({ cedears }) {
      const cash = cedears.setCash({ ARS: 21291.74, USD: 13.02 });
      return `disponible ARS ${cash.ARS} · USD ${cash.USD}`;
    },
  },
  {
    // The growth history still carried test data (fake deposits, test edits)
    // that patching did not fully remove: start it over from today. The first
    // point is captured right after start (index.js) and becomes the zero of
    // the chart. Holdings, operations and cash stay as they are.
    key: 'data_fix_2026_10_growth_reset',
    run({ snapshots }) {
      snapshots.clear();
      return 'historial de crecimiento borrado; arranca hoy';
    },
  },
];

export async function runDataFixes(db, services, { log = console, fixes = DATA_FIXES, backup = null } = {}) {
  const hasData = db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM cedear_operations) OR EXISTS (SELECT 1 FROM cedear_cash_movements)
         OR EXISTS (SELECT 1 FROM settings WHERE key LIKE 'cedears_opening_cash_%')
         OR EXISTS (SELECT 1 FROM crypto_holdings) OR EXISTS (SELECT 1 FROM snapshots) AS yes`,
    )
    .get().yes;
  const pending = fixes.filter((fix) => !getSetting(db, fix.key));
  if (!hasData || pending.length === 0) return;
  if (backup) {
    const name = `portfolio-antes-de-correcciones-${new Date().toISOString().slice(0, 10)}.db`;
    await backup(name);
    log.info(`[datos] copia de la base antes de corregir: backups/${name}`);
  }
  for (const fix of pending) {
    try {
      const result = fix.run(services);
      setSetting(db, fix.key, new Date().toISOString());
      log.info(`[datos] corrección ${fix.key} aplicada: ${result}`);
    } catch (err) {
      log.error(`[datos] no se pudo aplicar ${fix.key}: ${err.message}`);
    }
  }
}
