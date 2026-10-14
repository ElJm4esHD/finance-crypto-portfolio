import { clean } from './num.js';

// Mini trend line for the holdings list: up to `max` evenly spaced values
// (always keeping the first and the last one).
export function downsample(values, max = 48) {
  if (values.length <= max) return values;
  const step = (values.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * step)]);
}

// The day's trend of one symbol, built so that the line, its color and the
// % shown next to it can never disagree: they all come from this one series.
// It starts at the reference the day change is measured against (previous
// close, or the price of 24 h ago in crypto), goes through the intraday
// closes and ends at the current quoted price.
// quote: { price, previousClose } | null · chart: { points: [{ t, value }] } | null
// → { values, changePct } | null
export function trend(quote, chart) {
  const closes = (chart?.points ?? []).map((p) => p.value).filter((v) => v != null);
  const first = quote?.previousClose > 0 ? quote.previousClose : closes[0];
  const last = quote?.price ?? closes.at(-1);
  if (!(first > 0) || last == null) return null;
  return {
    values: downsample([first, ...closes, last]).map(clean),
    changePct: clean((last / first - 1) * 100),
  };
}

// symbols → { [symbol]: { values, changePct } }. Quotes are fetched once for
// all symbols (same cached quotes as the holdings); a symbol without quote
// nor chart is left out.
export async function sparklines(symbols, { getQuotes, getIntraday }) {
  if (symbols.length === 0) return {};
  const { quotes } = await getQuotes(symbols);
  const out = {};
  await Promise.all(
    symbols.map(async (s) => {
      let chart = null;
      try {
        chart = await getIntraday(s);
      } catch {
        // without the chart the line is just reference → price
      }
      const t = trend(quotes[s] ?? null, chart);
      if (t) out[s] = t;
    }),
  );
  return out;
}
