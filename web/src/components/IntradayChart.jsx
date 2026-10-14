import { useState } from 'preact/hooks';
import { fmtChartDate, fmtClock, fmtDate, fmtLongDate, fmtPct, fmtPrice, fmtStamp, todayIso } from '../format.js';
import { useApi } from '../hooks.js';
import { ErrorMessage, Loading, toneOf } from './ui.jsx';
import { LineChart } from './LineChart.jsx';
import { RangePicker } from './RangePicker.jsx';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const localIso = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthAgo = () => localIso(Date.now() - 30 * DAY);

const PERIOD = {
  '5D': 'Últimos 5 días',
  '1M': 'Último mes',
  '6M': 'Últimos 6 meses',
  YTD: 'En lo que va del año',
  '1A': 'Último año',
  Todo: 'Todo el historial',
};

// Axis labels: round hours for one day, otherwise four evenly spaced dates.
function axisLabels(kind, range, x0, x1) {
  if (range === '1D') {
    const step = kind === 'crypto' ? 6 * HOUR : 2 * HOUR;
    const out = [];
    for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) out.push({ x: t, label: fmtClock(t) });
    return out;
  }
  const days = (x1 - x0) / DAY;
  return [0, 1, 2, 3].map((i) => {
    const t = x0 + ((x1 - x0) * i) / 3;
    return { x: t, label: days <= 2 ? fmtClock(t) : fmtChartDate(localIso(t), days <= 200 ? 'daily' : 'monthly') };
  });
}

// Price of one coin or CEDEAR/ETF, shown inside an open row of the holdings
// list, with the same ranges as the growth chart. 1D is the last 24 h for
// crypto and the day's session (or the last one) for CEDEARs/ETF.
// dayChangePct: the row's day change, so 1D shows the very same %.
export function IntradayChart({ kind, symbol, dayChangePct = null }) {
  const [range, setRange] = useState('1D');
  const [custom, setCustom] = useState({ from: monthAgo(), to: todayIso() });
  const [showTable, setShowTable] = useState(false);
  const query = range === 'custom' ? `range=custom&from=${custom.from}&to=${custom.to}` : `range=${range}`;
  const { data, error, loading } = useApi(`/${kind}/chart/${encodeURIComponent(symbol)}?${query}`);

  const picker = <RangePicker value={range} onChange={setRange} custom={custom} onCustom={setCustom} max={todayIso()} />;

  let body;
  if (loading) body = <Loading />;
  else if (!data) body = <ErrorMessage>{error}</ErrorMessage>;
  else if (data.points.length < 2) {
    body = <p class="muted small">{symbol === 'USDT' ? 'USDT vale siempre 1 USD.' : `No hay datos de precio de ${symbol} para este período.`}</p>;
  } else {
    const { points, currency } = data;
    const series = points.map((p) => ({ x: p.t, value: p.value }));
    // 1D shows the row's day change (same series as its sparkline); other
    // ranges compare with their first point.
    const last = series.at(-1).value;
    const pct = range === '1D' && dayChangePct !== null ? dayChangePct : (last / series[0].value - 1) * 100;
    const session = kind === 'cedears' && range === '1D' ? data.session : null;
    const domain = session ? [Math.min(session.start, series[0].x), Math.max(session.end, series.at(-1).x)] : null;
    const [x0, x1] = domain ?? [series[0].x, series.at(-1).x];
    const days = (x1 - x0) / DAY;
    const sessionDay = localIso(series[0].x);
    const period =
      range === '1D'
        ? kind === 'crypto'
          ? 'Últimas 24 horas'
          : sessionDay === todayIso()
            ? `Sesión de hoy (${fmtClock(x0)} a ${fmtClock(x1)})`
            : `Última sesión, ${fmtDate(sessionDay)} (${fmtClock(x0)} a ${fmtClock(x1)})`
        : range === 'custom'
          ? `Del ${fmtDate(custom.from)} al ${fmtDate(custom.to)}`
          : PERIOD[range];
    const fmtValue = (v) => fmtPrice(v, currency ?? '');
    const fmtX = (t) => (range === '1D' && kind === 'cedears' ? fmtClock(t) : days <= 7 ? fmtStamp(t) : fmtLongDate(localIso(t)));
    const tone = toneOf(pct);

    body = (
      <>
        <div class="intraday-head">
          <span class="intraday-price">{fmtValue(last)}</span>
          <span class={`change-value ${tone}`}>{fmtPct(pct, { signed: true, digits: 2 })}</span>
          <span class="muted small">{period}</span>
        </div>
        <LineChart
          points={series}
          domain={domain}
          xLabels={axisLabels(kind, range, x0, x1)}
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
                  <th>{days <= 2 ? 'Hora' : 'Fecha'}</th>
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
      </>
    );
  }

  return (
    <div class="price-chart">
      {symbol !== 'USDT' && picker}
      {body}
    </div>
  );
}
