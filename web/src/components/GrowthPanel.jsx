import { useState } from 'preact/hooks';
import { fmtChartDate, fmtDate, fmtLongDate, fmtMoney, fmtSignedMoney } from '../format.js';
import { useApi } from '../hooks.js';
import { ErrorMessage, Loading, SignedChange } from './ui.jsx';
import { LineChart } from './LineChart.jsx';

const RANGES = [
  { id: '1M', days: 30 },
  { id: '3M', days: 91 },
  { id: '6M', days: 182 },
  { id: '1A', days: 365 },
  { id: 'Todo', days: null },
];
const DAY = 86400_000;
const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t) => new Date(t).toISOString().slice(0, 10);

// Ranges worth offering: the shortest one, plus each longer one once the
// history goes beyond the previous range.
function availableRanges(points) {
  if (points.length < 2) return [RANGES[0]];
  const span = (toTime(points.at(-1).date) - toTime(points[0].date)) / DAY;
  return RANGES.filter((r, i) => i === 0 || span > RANGES[i - 1].days);
}

// Long histories are drawn with the last value of each week.
function weekly(points) {
  const out = [];
  for (const p of points) {
    const week = Math.floor((toTime(p.date) / DAY + 3) / 7); // Monday-based weeks
    if (out.length && out.at(-1).week === week) out[out.length - 1] = { ...p, week };
    else out.push({ ...p, week });
  }
  return out;
}

// Portfolio value over time with the money invested underneath: a jump that
// comes from a deposit is flagged and does not count as performance.
// section: 'crypto' | 'cedears'. currency: 'ARS' | 'USD'.
export function GrowthPanel({ section, currency }) {
  const { data, error, loading } = useApi(`/${section}/growth?currency=${currency}`);
  const [rangeId, setRangeId] = useState('3M');
  const [showTable, setShowTable] = useState(false);

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  const unit = section === 'crypto' && currency === 'USD' ? 'USDT' : currency;
  const all = data.points;
  if (all.length === 0) {
    return (
      <div class="growth">
        <p class="muted">
          {data.missingRate
            ? 'Hace falta la cotización del dólar MEP para mostrar el historial en esta moneda.'
            : 'Todavía no hay historial. Cada día se guarda el valor de la cartera y el gráfico se va armando solo.'}
        </p>
      </div>
    );
  }

  const ranges = availableRanges(all);
  const range = ranges.find((r) => r.id === rangeId) ?? ranges.at(-1);
  const since = range.days ? toIso(toTime(all.at(-1).date) - range.days * DAY) : null;
  const inRange = since ? all.filter((p) => p.date >= since) : all;
  const points = inRange.length > 400 ? weekly(inRange) : inRange;

  const first = points[0];
  const last = points.at(-1);
  const contributed = last.invested - first.invested;
  const performance = last.value - first.value - contributed;
  const base = first.value + Math.max(contributed, 0);
  const performancePct = points.length > 1 && base > 0 ? (performance / base) * 100 : null;
  const tone = performance > 0 ? 'up' : performance < 0 ? 'down' : '';
  const flows = data.flows.filter((f) => f.date >= first.date && f.date <= last.date);
  const goal = section === 'crypto' && currency === 'USD' ? data.goal : null;
  const view = range.days && range.days <= 182 ? 'daily' : 'monthly';

  const series = points.map((p) => ({ x: toTime(p.date), value: p.value, invested: p.invested, date: p.date }));
  const labelIdx = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
  // Flows shown with a point: those after the previous point, up to this one.
  const flowsAt = (i) => flows.filter((f) => f.date <= points[i].date && (i === 0 || f.date > points[i - 1].date));

  return (
    <div class="growth">
      <div class="growth-head">
        <div class="growth-figures">
          <div class="growth-figure">
            <span>Rendimiento {range.id === 'Todo' ? 'total' : `en ${range.id}`}</span>
            <strong>
              {points.length > 1 ? <SignedChange change={performance} pct={performancePct} currency={unit} /> : '—'}
            </strong>
          </div>
          <div class="growth-figure">
            <span>Aportes netos</span>
            <strong>{fmtSignedMoney(contributed, unit)}</strong>
          </div>
          <div class="growth-figure">
            <span>Invertido</span>
            <strong>{fmtMoney(last.invested, unit)}</strong>
          </div>
        </div>
        {ranges.length > 1 && (
          <div class="ranges" role="radiogroup" aria-label="Período">
            {ranges.map((r) => (
              <button type="button" role="radio" aria-checked={r === range} class={r === range ? 'active' : ''} onClick={() => setRangeId(r.id)}>
                {r.id}
              </button>
            ))}
          </div>
        )}
      </div>

      <LineChart
        points={series}
        tone={tone}
        flags={flows.map((f) => ({ x: toTime(f.date), amount: f.amount }))}
        goal={goal}
        xLabels={labelIdx.map((i) => ({ x: series[i].x, label: fmtChartDate(series[i].date, view) }))}
        ariaLabel={`Valor de la cartera desde el ${fmtLongDate(first.date)}: ${fmtMoney(last.value, unit)}, con ${fmtMoney(last.invested, unit)} invertidos.`}
        renderTooltip={(p, i) => (
          <>
            <span class="tip-date">{fmtLongDate(p.date)}</span>
            <strong>{fmtMoney(p.value, unit)}</strong>
            <span class="tip-row">
              <span>Invertido</span>
              <span>{fmtMoney(p.invested, unit)}</span>
            </span>
            <span class="tip-row">
              <span>Rendimiento</span>
              <SignedChange change={p.value - p.invested} currency={unit} />
            </span>
            {flowsAt(i).map((f) => (
              <span class="tip-flow">
                {f.amount >= 0 ? 'Aporte' : 'Retiro'} {fmtSignedMoney(f.amount, unit)} · {fmtDate(f.date).slice(0, 5)}
              </span>
            ))}
          </>
        )}
      />

      <div class="legend">
        <span>
          <i class={`series-key ${tone}`} /> Valor
        </span>
        <span>
          <i class="invested-key" /> Invertido
        </span>
        {flows.length > 0 && (
          <span>
            <i class="flag-key" /> Aporte o retiro
          </span>
        )}
        <button type="button" class="link-btn" style={{ padding: 0, marginLeft: 'auto' }} onClick={() => setShowTable(!showTable)}>
          {showTable ? 'Ocultar tabla' : 'Ver como tabla'}
        </button>
      </div>
      {data.missingRate && <p class="fx-note">Algunos días no se muestran: no había cotización del dólar MEP para convertirlos.</p>}

      {showTable && (
        <div class="table-wrap scroll">
          <table class="table compact">
            <thead>
              <tr>
                <th>Fecha</th>
                <th class="num">Valor</th>
                <th class="num">Invertido</th>
                <th class="num">Rendimiento</th>
                <th class="num">Aportes</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => {
                const i = points.indexOf(p);
                const moved = flowsAt(i).reduce((s, f) => s + f.amount, 0);
                return (
                  <tr>
                    <td>{fmtDate(p.date)}</td>
                    <td class="num">{fmtMoney(p.value, unit)}</td>
                    <td class="num">{fmtMoney(p.invested, unit)}</td>
                    <td class="num">
                      <SignedChange change={p.value - p.invested} currency={unit} />
                    </td>
                    <td class="num">{moved ? fmtSignedMoney(moved, unit) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
