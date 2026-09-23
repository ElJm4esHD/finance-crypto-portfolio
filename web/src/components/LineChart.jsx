import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtCompact } from '../format.js';

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

// Axis labels: compact ("12,5 mil") unless that makes neighbors look equal
// (a narrow range of large prices), then as many decimals as the step needs.
function tickLabels(ticks) {
  const compact = ticks.map((t) => fmtCompact(t));
  if (new Set(compact).size === compact.length) return compact;
  const step = Math.abs(ticks[1] - ticks[0]) || 1;
  const digits = Math.max(0, Math.ceil(-Math.log10(step)));
  const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return ticks.map((t) => nf.format(t));
}

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return width;
}

// Single-series line chart over a numeric x (a timestamp), with an optional
// goal reference line. Hover/touch or arrow keys show the value at each point.
//   points       [{ x, value }] sorted by x
//   domain       [x0, x1] to show a fixed range (e.g. a whole market session)
//   xLabels      [{ x, label }] shown under the plot
//   formatValue  value → text for the tooltip
//   formatX      x → text for the tooltip
//   formatEnd    value → label at the last point (compact by default)
export function LineChart({ points, domain, xLabels, formatValue, formatX, formatEnd = fmtCompact, ariaLabel, goal }) {
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
  const yLabels = tickLabels(ticks);

  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const [t0, t1] = domain ?? [points[0].x, points.at(-1).x];
  const x = (v) => PAD.left + (t1 === t0 ? plotW / 2 : ((v - t0) / (t1 - t0)) * plotW);
  const y = (v) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const last = points.at(-1);
  const labels = plotW < 260 && xLabels.length > 2 ? [xLabels[0], xLabels.at(-1)] : xLabels;
  const anchor = (i) => (labels.length < 2 ? 'middle' : i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle');

  function onPointer(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + PAD.left - 10;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.x) - px) < Math.abs(x(points[best].x) - px)) best = i;
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
  const tooltipLeft = a ? Math.min(Math.max(x(a.x), 70), width - 70) : 0;

  return (
    <div class="chart" ref={wrapRef}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel} tabindex="0" onKeyDown={onKey} onBlur={() => setActive(null)}>
          {ticks.map((t, i) => (
            <g>
              <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text class="axis-label" x={PAD.left - 8} y={y(t)} dy="0.32em" text-anchor="end">
                {yLabels[i]}
              </text>
            </g>
          ))}
          {labels.map((l, i) => (
            <text class="axis-label" x={x(l.x)} y={HEIGHT - 8} text-anchor={anchor(i)}>
              {l.label}
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
          <circle class="series-dot" cx={x(last.x)} cy={y(last.value)} r="5" />
          <text class="end-label" x={x(last.x)} y={y(last.value) - 12} text-anchor={x(last.x) > width / 2 ? 'end' : 'middle'}>
            {formatEnd(last.value)}
          </text>

          {a && (
            <g>
              <line class="crosshair" x1={x(a.x)} x2={x(a.x)} y1={PAD.top} y2={PAD.top + plotH} />
              <circle class="series-dot" cx={x(a.x)} cy={y(a.value)} r="5" />
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
          <strong>{formatValue(a.value)}</strong>
          <span>{formatX(a.x)}</span>
        </div>
      )}
    </div>
  );
}
