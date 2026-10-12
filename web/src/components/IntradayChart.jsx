import { useState } from 'preact/hooks';
import { fmtClock, fmtDate, fmtPct, fmtPrice, fmtStamp, todayIso } from '../format.js';
import { useApi } from '../hooks.js';
import { ErrorMessage, Loading, toneOf } from './ui.jsx';
import { LineChart } from './LineChart.jsx';

const HOUR = 3600_000;
const localIso = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Intraday price of one coin (last 24 h) or one CEDEAR/ETF (today's session,
// or the last one while the market is closed). Shown inside an open row of
// the holdings list.
export function IntradayChart({ kind, symbol }) {
  const { data, error, loading } = useApi(`/${kind}/chart/${encodeURIComponent(symbol)}`);
  const [showTable, setShowTable] = useState(false);

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;
  if (data.points.length < 2) {
    return <p class="muted small">{symbol === 'USDT' ? 'USDT vale siempre 1 USD.' : `No hay datos intradía de ${symbol} para mostrar.`}</p>;
  }

  const { points, currency } = data;
  const series = points.map((p) => ({ x: p.t, value: p.value }));
  // Change against the previous close when the API gives it (same as the
  // day change of the row), otherwise against the first point of the chart.
  const reference = data.previousClose ?? series[0].value;
  const last = series.at(-1).value;
  const pct = reference ? (last / reference - 1) * 100 : null;
  const session = kind === 'cedears' ? data.session : null;
  const domain = session ? [Math.min(session.start, series[0].x), Math.max(session.end, series.at(-1).x)] : null;
  const [x0, x1] = domain ?? [series[0].x, series.at(-1).x];
  const step = kind === 'crypto' ? 6 * HOUR : 2 * HOUR;
  const xLabels = [];
  for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) xLabels.push({ x: t, label: fmtClock(t) });
  const sessionDay = localIso(series[0].x);
  const period =
    kind === 'crypto'
      ? 'Últimas 24 horas'
      : sessionDay === todayIso()
        ? `Sesión de hoy (${fmtClock(x0)} a ${fmtClock(x1)})`
        : `Última sesión, ${fmtDate(sessionDay)} (${fmtClock(x0)} a ${fmtClock(x1)})`;
  const fmtValue = (v) => fmtPrice(v, currency ?? '');
  const fmtX = kind === 'crypto' ? fmtStamp : fmtClock;
  const tone = toneOf(pct);

  return (
    <div>
      <div class="intraday-head">
        <span class="intraday-price">{fmtValue(last)}</span>
        <span class={`change-value ${tone}`}>{fmtPct(pct, { signed: true, digits: 2 })}</span>
        <span class="muted small">{period}</span>
      </div>
      <LineChart
        points={series}
        domain={domain}
        xLabels={xLabels}
        tone={tone}
        height={200}
        formatEnd={fmtValue}
        ariaLabel={`Precio de ${symbol}: ${period.toLowerCase()}. Último ${fmtValue(last)}, ${fmtPct(pct, { signed: true, digits: 2 })}.`}
        renderTooltip={(p) => (
          <>
            <strong>{fmtValue(p.value)}</strong>
            <span class="tip-date">{fmtX(p.x)}</span>
          </>
        )}
      />
      <button type="button" class="link-btn" onClick={() => setShowTable(!showTable)}>
        {showTable ? 'Ocultar tabla' : 'Ver como tabla'}
      </button>
      {showTable && (
        <div class="table-wrap scroll">
          <table class="table compact">
            <thead>
              <tr>
                <th>Hora</th>
                <th class="num">Precio</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((p) => (
                <tr>
                  <td>{fmtX(p.x)}</td>
                  <td class="num">{fmtValue(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
