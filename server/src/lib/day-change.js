import { clean } from './num.js';

// Day change of a portfolio whose current total is `total` and whose value
// moved `change` since the previous close (null → no data).
export function dayChangeSummary(total, change) {
  if (change === null) return { dayChange: null, dayChangePct: null };
  const previous = total - change;
  return {
    dayChange: clean(change),
    dayChangePct: previous > 0 ? clean((change / previous) * 100) : null,
  };
}
