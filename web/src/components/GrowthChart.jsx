import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtChartDate, fmtCompact, fmtLongDate, fmtMoney } from '../format.js';

const HEIGHT = 260;
const PAD = { top: 28, right: 16, bottom: 28, left: 52 };

// Clean round ticks (1, 2, 2.5, 5 × 10^n) covering [min, max].
function niceTicks(min, max, count = 4) {
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`);

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return width;
}

// Single-series line chart of portfolio value over time, with an optional
// goal reference line. Hover/touch or arrow keys show the value at each date.
export function GrowthChart({ points, currency, view, goal }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [active, setActive] = useState(null);

  useEffect(() => setActive(null), [points]);

  const values = points.map((p) => p.value);
  const maxVal = Math.max(...values);
  // Only draw the goal when it fits without flattening the line.
  const showGoal = goal != null && goal > 0 && goal <= maxVal * 1.5;
  const domainVals = showGoal ? [...values, goal] : values;
  const ticks = niceTicks(Math.min(...domainVals), Math.max(...domainVals));
  const yMin = ticks[0];
  const yMax = ticks.at(-1);

  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const t0 = toTime(points[0].date);
  const t1 = toTime(points.at(-1).date);
  const x = (iso) => PAD.left + (t1 === t0 ? plotW / 2 : ((toTime(iso) - t0) / (t1 - t0)) * plotW);
  const y = (v) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const last = points.at(-1);

  // X labels: first, middle and last, skipping ones that would collide.
  const labelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const xLabels = plotW < 260 ? [0, points.length - 1] : labelIdx;

  function onPointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    });
    setActive(best);
  }

  function onKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = active ?? points.length - 1;
    setActive(Math.min(points.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1))));
  }

  const a = active === null ? null : points[active];
  const tooltipLeft = a ? Math.min(Math.max(x(a.date), 70), width - 70) : 0;

  return (
    <div class="chart" ref={wrapRef}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Evolución del valor de la cartera. Último valor ${fmtMoney(last.value, currency)} el ${fmtLongDate(last.date)}.`}
          tabindex="0"
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g>
              <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text class="axis-label" x={PAD.left - 8} y={y(t)} dy="0.32em" text-anchor="end">
                {fmtCompact(t)}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text
              class="axis-label"
              x={x(points[i].date)}
              y={HEIGHT - 8}
              text-anchor={i === 0 && points.length > 1 ? 'start' : i === points.length - 1 && points.length > 1 ? 'end' : 'middle'}
            >
              {fmtChartDate(points[i].date, view)}
            </text>
          ))}

          {showGoal && (
            <g>
              <line class="goal-line" x1={PAD.left} x2={width - PAD.right} y1={y(goal)} y2={y(goal)} />
              <text class="goal-label" x={PAD.left + 4} y={y(goal) - 6}>
                Objetivo {fmtCompact(goal)}
              </text>
            </g>
          )}

          <path class="series-line" d={path} />

          {/* End value, labeled directly at the last point. */}
          <circle class="series-dot" cx={x(last.date)} cy={y(last.value)} r="5" />
          <text class="end-label" x={x(last.date)} y={y(last.value) - 12} text-anchor={points.length > 1 ? 'end' : 'middle'}>
            {fmtCompact(last.value)}
          </text>

          {a && (
            <g>
              <line class="crosshair" x1={x(a.date)} x2={x(a.date)} y1={PAD.top} y2={PAD.top + plotH} />
              <circle class="series-dot" cx={x(a.date)} cy={y(a.value)} r="5" />
            </g>
          )}

          <rect
            x={PAD.left - 10}
            y={0}
            width={plotW + 20}
            height={HEIGHT}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {a && (
        <div class="chart-tooltip" style={{ left: `${tooltipLeft}px` }}>
          <strong>{fmtMoney(a.value, currency)}</strong>
          <span>{fmtLongDate(a.date)}</span>
        </div>
      )}
    </div>
  );
}
