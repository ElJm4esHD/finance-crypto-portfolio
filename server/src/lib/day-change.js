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

// Invested money vs. what the market did with it: performance is the current
// value minus the net money put in (deposits − withdrawals), so a new deposit
// never shows up as a gain. null invested → unknown.
export function performanceSummary(total, invested) {
  if (invested === null) return { invested: null, performance: null, performancePct: null };
  const performance = total - invested;
  return {
    invested: clean(invested),
    performance: clean(performance),
    performancePct: invested > 0 ? clean((performance / invested) * 100) : null,
  };
}
