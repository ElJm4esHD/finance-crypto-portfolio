// Converting history between ARS and USD: each date uses the dólar MEP of
// that day (or the closest earlier one). Dates before the first known rate
// use the first one; without any history, the current rate.

// history: [{ date, rate }] sorted by date. → (date) => rate | null
export function rateLookup(history, current = null) {
  return (date) => {
    if (history.length === 0) return current;
    let rate = history[0].rate;
    for (const h of history) {
      if (h.date > date) break;
      rate = h.rate;
    }
    return rate;
  };
}

const base = (c) => (c === 'USDT' ? 'USD' : c);

// ARS ↔ USD (USDT counts as USD). null when a rate is needed and missing.
export function convert(amount, from, to, rate) {
  if (base(from) === base(to)) return amount;
  if (!rate) return null;
  return base(from) === 'USD' ? amount * rate : amount / rate;
}
