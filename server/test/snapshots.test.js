import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { aggregate, createSnapshotService } from '../src/snapshots/service.js';

const silent = { warn() {} };

test('aggregation keeps the last value of each period', () => {
  const points = [
    { date: '2026-01-30', value: 1 },
    { date: '2026-01-31', value: 2 }, // Saturday, week 05
    { date: '2026-02-01', value: 3 }, // Sunday, week 05
    { date: '2026-02-02', value: 4 }, // Monday, week 06
    { date: '2027-03-01', value: 5 },
  ];
  assert.deepEqual(aggregate(points, 'weekly').map((p) => p.value), [3, 4, 5]);
  assert.deepEqual(aggregate(points, 'monthly').map((p) => p.value), [2, 4, 5]);
  assert.deepEqual(aggregate(points, 'yearly').map((p) => p.value), [4, 5]);
  assert.equal(aggregate(points, 'daily').length, 5);
});

test('capturing twice on the same day overwrites the value', async () => {
  let value = 100;
  const svc = createSnapshotService(openDb(':memory:'), {
    crypto: { snapshotValue: async () => ({ value, currency: 'USDT' }) },
    cedears: { snapshotValue: async () => null },
  }, silent);
  await svc.capture('crypto', '2026-09-01');
  value = 120;
  await svc.capture('crypto', '2026-09-01');
  await svc.capture('cedears', '2026-09-01'); // nothing to record
  const growth = svc.getGrowth('crypto');
  assert.deepEqual(growth.series.daily, [{ date: '2026-09-01', value: 120 }]);
  assert.equal(growth.currency, 'USDT');
  assert.deepEqual(growth.available, ['daily']);
  assert.deepEqual(svc.getGrowth('cedears').available, []);
});

test('longer views become available as history accumulates', async () => {
  const svc = createSnapshotService(openDb(':memory:'), {
    crypto: { snapshotValue: async () => ({ value: 1, currency: 'USDT' }) },
  }, silent);
  for (const d of ['2025-12-30', '2026-01-02', '2026-01-10']) await svc.capture('crypto', d);
  assert.deepEqual(svc.getGrowth('crypto').available, ['daily', 'weekly', 'monthly', 'yearly']);
});

test('a failing price source skips the snapshot instead of crashing', async () => {
  const svc = createSnapshotService(openDb(':memory:'), {
    crypto: { snapshotValue: async () => { throw new Error('offline'); } },
  }, silent);
  assert.equal(await svc.capture('crypto', '2026-09-01'), null);
  assert.equal(svc.getGrowth('crypto').series.daily.length, 0);
});
