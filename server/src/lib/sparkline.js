// Mini trend line for the holdings list: up to `max` evenly spaced closes of
// the intraday chart (always keeping the last one).
export function downsample(values, max = 48) {
  if (values.length <= max) return values;
  const step = (values.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * step)]);
}

// symbols → { [symbol]: number[] }, from each one's intraday chart (cached).
// A symbol whose chart fails or is empty is just left out.
export async function sparklines(symbols, getIntraday) {
  const out = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const chart = await getIntraday(s);
        if (chart?.points?.length > 1) out[s] = downsample(chart.points.map((p) => p.value));
      } catch {
        // no line for this one
      }
    }),
  );
  return out;
}
