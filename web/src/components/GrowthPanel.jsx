import { useState } from 'preact/hooks';
import { fmtChartDate, fmtDate, fmtLongDate, fmtMoney, fmtSignedMoney } from '../format.js';
import { useApi } from '../hooks.js';
import { ErrorMessage, Icon, Loading, SignedChange } from './ui.jsx';
import { LineChart } from './LineChart.jsx';

const DAY = 86400_000;
const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t) => new Date(t).toISOString().slice(0, 10);

// Time ranges, like trading apps. `since(last)` gives the first date shown,
// counted back from the last snapshot; null = the whole history. With little
// history a long range simply shows what there is.
const back = (days) => (last) => toIso(toTime(last) - days * DAY);
const RANGES = [
  { id: '1D', label: '1 día', since: back(1) },
  { id: '5D', label: '5 días', since: back(5) },
  { id: '1M', label: '1 mes', since: back(30) },
  { id: '6M', label: '6 meses', since: back(182) },
  { id: 'YTD', label: 'en el año', since: (last) => `${last.slice(0, 4)}-01-01` },
  { id: '1A', label: '1 año', since: back(365) },
  { id: 'Todo', label: 'total (desde que invertiste)', since: () => null },
  { id: 'custom', short: 'Personalizado', label: 'en el período' },
];

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
  const [rangeId, setRangeId] = useState('1M');
  const [custom, setCustom] = useState({ from: '', to: '' });
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

  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[2];
  const firstDate = all[0].date;
  const lastDate = all.at(-1).date;
  const from = range.id === 'custom' ? custom.from || firstDate : range.since(lastDate);
  const to = range.id === 'custom' ? custom.to || lastDate : lastDate;
  const inRange = all.filter((p) => (!from || p.date >= from) && p.date <= to);
  const points = inRange.length > 400 ? weekly(inRange) : inRange;

  // One definition of performance for the whole app, the same as the
  // summary: value − money invested (deposits/withdrawals never count).
  // "Todo" shows it as is, so it equals the summary's total performance
  // (the last point is today's live value). Any other range shows how much
  // that same performance changed within the range, so it is 0 at the
  // range's first point.
  const first = points[0];
  const last = points.at(-1);
  const isTotal = range.id === 'Todo';
  const total = (p) => p.value - p.invested;
  const performanceAt = (p) => (isTotal ? total(p) : total(p) - total(first));
  const contributed = last ? last.invested - first.invested : 0;
  const performance = last ? performanceAt(last) : 0;
  const base = isTotal ? last?.invested ?? 0 : first ? first.value + Math.max(contributed, 0) : 0;
  const performancePct = base > 0 ? (performance / base) * 100 : null;
  const tone = performance > 0 ? 'up' : performance < 0 ? 'down' : '';
  const flows = last ? data.flows.filter((f) => f.date >= first.date && f.date <= last.date) : [];
  const goal = section === 'crypto' && currency === 'USD' ? data.goal : null;
  const spanDays = last ? (toTime(last.date) - toTime(first.date)) / DAY : 0;
  const view = spanDays <= 190 ? 'daily' : 'monthly';

  const picker = (
    <div class="range-picker">
      <div class="ranges" role="radiogroup" aria-label="Período">
        {RANGES.map((r) => (
          <button
            type="button"
            role="radio"
            aria-checked={r === range}
            aria-label={r.short}
            title={r.short}
            class={`${r === range ? 'active' : ''} ${r.short ? 'range-custom' : ''}`}
            onClick={() => setRangeId(r.id)}
          >
            {r.short ? (
              <>
                <span class="range-text">{r.short}</span>
                <Icon name="calendar" />
              </>
            ) : (
              r.id
            )}
          </button>
        ))}
      </div>
      {range.id === 'custom' && (
        <div class="custom-range">
          <label>
            <span>Desde</span>
            <input type="date" value={custom.from || firstDate} min={firstDate} max={lastDate} onInput={(e) => setCustom((c) => ({ ...c, from: e.currentTarget.value }))} />
          </label>
          <label>
            <span>Hasta</span>
            <input type="date" value={custom.to || lastDate} min={firstDate} max={lastDate} onInput={(e) => setCustom((c) => ({ ...c, to: e.currentTarget.value }))} />
          </label>
        </div>
      )}
    </div>
  );

  if (points.length === 0) {
    return (
      <div class="growth">
        {picker}
        <p class="muted">No hay datos guardados entre esas fechas.</p>
      </div>
    );
  }

  const series = points.map((p) => ({ x: toTime(p.date), value: p.value, invested: p.invested, date: p.date }));
  const labelIdx = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
  // Flows shown with a point: those after the previous point, up to this one.
  const flowsAt = (i) => flows.filter((f) => f.date <= points[i].date && (i === 0 || f.date > points[i - 1].date));

  return (
    <div class="growth">
      {picker}
      <div class="growth-head">
        <div class="growth-figures">
          <div class="growth-figure">
            <span>Rendimiento {range.label}</span>
            <strong>
              <SignedChange change={performance} pct={performancePct} currency={unit} />
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
              <SignedChange change={performanceAt(p)} currency={unit} />
            </span>
            {flowsAt(i).map((f) => (
              <span class="tip-flow">
                {f.amount >= 0 ? 'Aporte' : 'Retiro'} {fmtSignedMoney(f.amount, unit)} · {fmtDate(f.date).slice(0, 5)}
              </span>
            ))}
          </>
        )}
      />

      {all.length === 1 && (
        <p class="fx-note">Primer día del historial: el gráfico suma un punto por día.</p>
      )}

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
                      <SignedChange change={performanceAt(p)} currency={unit} />
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
