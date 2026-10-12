// Mini trend line for the holdings list. `values` oldest first; the color
// follows the day change (tone). Nothing to draw → an empty slot.
export function Sparkline({ values, tone }) {
  const w = 110;
  const h = 34;
  if (!values || values.length < 2) return <svg class="asset-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`)
    .join('');
  return (
    <svg class="asset-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path class={`spark-line ${tone || 'flat'}`} d={d} vector-effect="non-scaling-stroke" />
    </svg>
  );
}
