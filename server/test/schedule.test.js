import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastRun, nextRun, WEEKDAYS } from '../src/lib/schedule.js';

test('daily schedule: next and last run, optionally weekdays only', () => {
  const wed = new Date(2026, 8, 23, 12, 0); // local time
  assert.deepEqual(nextRun(wed, '10:30'), new Date(2026, 8, 24, 10, 30));
  assert.deepEqual(nextRun(wed, '23:59'), new Date(2026, 8, 23, 23, 59));
  assert.deepEqual(lastRun(wed, '10:30'), new Date(2026, 8, 23, 10, 30));
  const sat = new Date(2026, 8, 26, 18, 0);
  assert.deepEqual(nextRun(sat, '17:30', WEEKDAYS), new Date(2026, 8, 28, 17, 30));
  assert.deepEqual(lastRun(sat, '17:30', WEEKDAYS), new Date(2026, 8, 25, 17, 30));
});
