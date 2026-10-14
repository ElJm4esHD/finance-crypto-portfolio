import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trend } from '../src/lib/sparkline.js';

test('the trend starts at the previous close and ends at the quoted price', () => {
  // Opened below the previous close and recovered a bit: still a loss on the day.
  const quote = { price: 27000, previousClose: 27160 };
  const chart = { points: [{ t: 1, value: 26880 }, { t: 2, value: 26950 }, { t: 3, value: 26990 }] };
  const t = trend(quote, chart);
  assert.deepEqual(t.values, [27160, 26880, 26950, 26990, 27000]);
  assert.equal(t.changePct, -0.589101620029453);
  assert.ok(t.values.at(-1) < t.values[0]); // the line goes down, as the % says
});

test('the trend works with only a quote or only a chart', () => {
  assert.deepEqual(trend({ price: 110, previousClose: 100 }, null), { values: [100, 110], changePct: 10 });
  assert.deepEqual(trend(null, { points: [{ t: 1, value: 50 }, { t: 2, value: 40 }] }), { values: [50, 50, 40, 40], changePct: -20 });
  assert.equal(trend(null, null), null);
});
