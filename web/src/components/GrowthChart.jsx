import { fmtChartDate, fmtLongDate, fmtMoney } from '../format.js';
import { LineChart } from './LineChart.jsx';

const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t) => new Date(t).toISOString().slice(0, 10);

// Portfolio value over time (one point per day, week, month or year).
export function GrowthChart({ points, currency, view, goal }) {
  const series = points.map((p) => ({ x: toTime(p.date), value: p.value }));
  const labelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const last = points.at(-1);
  return (
    <LineChart
      points={series}
      xLabels={labelIdx.map((i) => ({ x: series[i].x, label: fmtChartDate(points[i].date, view) }))}
      formatValue={(v) => fmtMoney(v, currency)}
      formatX={(t) => fmtLongDate(toIso(t))}
      ariaLabel={`Evolución del valor de la cartera. Último valor ${fmtMoney(last.value, currency)} el ${fmtLongDate(last.date)}.`}
      goal={goal}
    />
  );
}
