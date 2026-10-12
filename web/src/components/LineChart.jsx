import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { fmtCompact } from '../format.js';

const PAD = { top: 24, right: 14, bottom: 28, left: 52 };

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

// Area chart of one series over a numeric x (a timestamp), colored by `tone`
// (up/down). Optional: a dashed `invested` line under it, flags on the dates
// money came in or out, and a goal line. Hover/touch or arrow keys show the
// tooltip that `renderTooltip(point)` returns.
//   points   [{ x, value, invested? }] sorted by x
//   domain   [x0, x1] to show a fixed range (e.g. a whole market session)
//   xLabels  [{ x, label }] shown under the plot
//   flags    [{ x, amount }] deposits (+) and withdrawals (−)
export function LineChart({ points, domain, xLabels, tone = '', flags = [], goal, renderTooltip, formatEnd = fmtCompact, ariaLabel, height = 260 }) {
  const wrapRef = useRef(null);
  const gradientId = `area-${useId()}`;
  const width = useWidth(wrapRef);
  const [active, setActive] = useState(null);

  useEffect(() => setActive(null), [points]);

  const hasInvested = points.some((p) => p.invested != null);
  const values = points.flatMap((p) => (p.invested != null ? [p.value, p.invested] : [p.value]));
  const maxVal = Math.max(...values);
  // Only draw the goal when it fits without flattening the line.
  const showGoal = goal != null && goal > 0 && goal <= maxVal * 1.5;
  const domainVals = showGoal ? [...values, goal] : values;
  const ticks = niceTicks(Math.min(...domainVals), Math.max(...domainVals));
  const yLabels = tickLabels(ticks);
  const yMin = ticks[0];
  const yMax = ticks.at(-1);

  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = height - PAD.top - PAD.bottom;
  const bottom = PAD.top + plotH;
  const [t0, t1] = domain ?? [points[0].x, points.at(-1).x];
  const x = (v) => PAD.left + (t1 === t0 ? plotW / 2 : ((v - t0) / (t1 - t0)) * plotW);
  const y = (v) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const pathOf = (key) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const line = pathOf('value');
  const area = `${line}L${x(points.at(-1).x).toFixed(1)},${bottom}L${x(points[0].x).toFixed(1)},${bottom}Z`;
  const last = points.at(-1);
  const shownFlags = flags.filter((f) => f.x >= t0 && f.x <= t1);
  const labels = plotW < 260 && xLabels.length > 2 ? [xLabels[0], xLabels.at(-1)] : xLabels;
  const anchor = (l) => (x(l.x) < PAD.left + 30 ? 'start' : x(l.x) > width - PAD.right - 30 ? 'end' : 'middle');

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
  const tooltipLeft = a ? Math.min(Math.max(x(a.x), 90), width - 90) : 0;

  return (
    <div class="chart" ref={wrapRef} style={{ minHeight: `${height}px` }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} tabindex="0" onKeyDown={onKey} onBlur={() => setActive(null)}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" class={`area-stop ${tone}`} stop-opacity="0.28" />
              <stop offset="100%" class={`area-stop ${tone}`} stop-opacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((t, i) => (
            <g>
              <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text class="axis-label" x={PAD.left - 8} y={y(t)} dy="0.32em" text-anchor="end">
                {yLabels[i]}
              </text>
            </g>
          ))}
          {labels.map((l) => (
            <text class="axis-label" x={x(l.x)} y={height - 8} text-anchor={anchor(l)}>
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

          <path d={area} fill={`url(#${gradientId})`} />
          {hasInvested && <path class="invested-line" d={pathOf('invested')} />}
          <path class={`series-line ${tone}`} d={line} />

          {/* Money in (+) or out (−): a marker on the baseline and a guide up. */}
          {shownFlags.map((f) => (
            <g>
              <line class="flag-line" x1={x(f.x)} x2={x(f.x)} y1={PAD.top} y2={bottom} />
              <circle class="flag-dot" cx={x(f.x)} cy={bottom} r="8" />
              <text class="flag-sign" x={x(f.x)} y={bottom} dy="0.35em" text-anchor="middle">
                {f.amount >= 0 ? '+' : '−'}
              </text>
            </g>
          ))}

          {/* End value, labeled directly at the last point. */}
          <circle class={`series-dot ${tone}`} cx={x(last.x)} cy={y(last.value)} r="4.5" />
          <text class="end-label" x={x(last.x)} y={y(last.value) - 12} text-anchor={x(last.x) > width / 2 ? 'end' : 'middle'}>
            {formatEnd(last.value)}
          </text>

          {a && (
            <g>
              <line class="crosshair" x1={x(a.x)} x2={x(a.x)} y1={PAD.top} y2={bottom} />
              <circle class={`series-dot ${tone}`} cx={x(a.x)} cy={y(a.value)} r="5" />
            </g>
          )}

          <rect
            x={PAD.left - 10}
            y={0}
            width={plotW + 20}
            height={height}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {a && (
        <div class="chart-tooltip" style={{ left: `${tooltipLeft}px` }}>
          {renderTooltip(a, active)}
        </div>
      )}
    </div>
  );
}
