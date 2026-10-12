import { useState } from 'preact/hooks';
import { fmtMoney, fmtPct } from '../format.js';

// Categorical slots, dark steps, in the validated order (CVD-safe as
// neighbors). Gains/losses keep green/red; "Otros" is neutral.
const SLOTS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)'];
const OTHER = 'var(--cat-other)';
const MAX_SLICES = SLOTS.length;

// Biggest holdings get a slice each (up to 5), the rest goes to "Otros".
// Colors follow the asset, not its rank: the shown symbols take the slots in
// alphabetical order, so a price move never repaints them.
// items: [{ symbol, value }] → { slices: [{ symbol, value, color }], colors: Map }
export function distribution(items) {
  const positive = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const top = positive.slice(0, MAX_SLICES);
  const colors = new Map(top.map((i) => i.symbol).sort().map((s, i) => [s, SLOTS[i]]));
  const rest = positive.slice(top.length);
  const slices = top.map((i) => ({ ...i, color: colors.get(i.symbol) }));
  if (rest.length) slices.push({ symbol: `Otros (${rest.length})`, value: rest.reduce((s, i) => s + i.value, 0), color: OTHER, other: true });
  return { slices, colors };
}

const R = 70;
const INNER = 50;
const point = (angle, r) => [80 + r * Math.sin(angle), 80 - r * Math.cos(angle)];

function arc(start, end) {
  const large = end - start > Math.PI ? 1 : 0;
  const [x0, y0] = point(start, R);
  const [x1, y1] = point(end, R);
  const [x2, y2] = point(end, INNER);
  const [x3, y3] = point(start, INNER);
  return `M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${INNER},${INNER} 0 ${large} 0 ${x3},${y3}Z`;
}

// Donut of how the portfolio is split, with a legend that doubles as the
// table (symbol, share and amount). Hovering a slice or a row highlights it.
export function Distribution({ title, note, slices, currency }) {
  const [active, setActive] = useState(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;

  let angle = 0;
  const arcs = slices.map((s) => {
    const start = angle;
    angle += (s.value / total) * Math.PI * 2;
    return { ...s, start, end: angle };
  });
  const shown = active === null ? null : arcs[active];

  return (
    <section class="card distribution" aria-label={title}>
      <div class="card-head">
        <h2 class="card-title">{title}</h2>
      </div>
      <div class="distribution-body">
        <svg viewBox="0 0 160 160" class="donut" role="img" aria-label={`${title}: ${slices.map((s) => `${s.symbol} ${fmtPct((s.value / total) * 100)}`).join(', ')}`}>
          {arcs.length === 1 ? (
            <circle cx="80" cy="80" r={(R + INNER) / 2} fill="none" stroke={arcs[0].color} stroke-width={R - INNER} />
          ) : (
            arcs.map((a, i) => (
              <path
                d={arc(a.start, a.end)}
                fill={a.color}
                class={`slice ${active !== null && active !== i ? 'faded' : ''}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
              />
            ))
          )}
          <text x="80" y="76" text-anchor="middle" class="donut-label">
            {shown ? shown.symbol.replace(/ \(\d+\)$/, '') : slices.filter((s) => !s.other).length + (slices.some((s) => s.other) ? '+' : '')}
          </text>
          <text x="80" y="95" text-anchor="middle" class="donut-sub">
            {shown ? fmtPct((shown.value / total) * 100) : 'activos'}
          </text>
        </svg>
        <ul class="legend-list">
          {arcs.map((a, i) => (
            <li class={active !== null && active !== i ? 'faded' : ''} onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}>
              <i style={{ background: a.color }} aria-hidden="true" />
              <span class="legend-symbol">{a.symbol}</span>
              <span class="legend-pct">{fmtPct((a.value / total) * 100)}</span>
              <span class="legend-value">{fmtMoney(a.value, currency)}</span>
            </li>
          ))}
        </ul>
      </div>
      {note && <p class="fx-note">{note}</p>}
    </section>
  );
}
