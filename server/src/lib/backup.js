import fs from 'node:fs';
import path from 'node:path';
import { localDate } from './dates.js';

// One consistent copy of the database per day in <dataDir>/backups, keeping
// the most recent `keep` files. Safe to call often: it only writes once a day.
export async function dailyBackup(db, dataDir, keep, log = console) {
  const dir = path.join(dataDir, 'backups');
  const file = path.join(dir, `portfolio-${localDate()}.db`);
  if (fs.existsSync(file)) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    await db.backup(file);
    const old = fs.readdirSync(dir).filter((f) => /^portfolio-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep);
    for (const f of old) fs.rmSync(path.join(dir, f));
    log.info(`[backup] copia guardada en ${file}`);
  } catch (err) {
    log.error(`[backup] no se pudo guardar la copia: ${err.message}`);
  }
}
