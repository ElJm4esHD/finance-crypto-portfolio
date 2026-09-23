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

// Money (available cash in ARS/USD) is kept in cents. Summing many float
// amounts leaves noise like -0.0000000001 that an absolute epsilon cannot
// absorb on large ARS balances and that shows up as "-0,00" in the UI.
// Rounding to cents (and never returning -0) makes "spend exactly what you
// have" land on 0 and any real shortfall a visible negative number.
export function cents(n) {
  return Math.round(clean(n * 100)) / 100 || 0;
}

// True when a money result is below zero once rounded to cents.
export const isNegativeMoney = (n) => cents(n) < 0;
