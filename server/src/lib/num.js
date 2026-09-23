// Amounts are stored as SQLite REAL. Rounding every result to 15 significant
// digits removes binary float noise (0.1 + 0.2 → 0.3) without losing any
// precision that matters for crypto amounts or prices.
export function clean(n) {
  return n === 0 ? 0 : Number.parseFloat(Number(n).toPrecision(15));
}

// Tolerance used when checking balances, so "spend exactly what you have" works.
export const EPSILON = 1e-9;

export function isNegative(n) {
  return n < -EPSILON;
}
