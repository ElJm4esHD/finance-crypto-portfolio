import { useState } from 'preact/hooks';
import { fmtDate, fmtMoney, fmtPct, fmtSignedMoney } from '../format.js';
import { GrowthChart } from './GrowthChart.jsx';
import { Segmented } from './ui.jsx';

const VIEW_LABELS = { daily: 'Diario', weekly: 'Semanal', monthly: 'Mensual', yearly: 'Anual' };

// Chart card shared by both portfolios: view selector, change in the period,
// the chart itself and an optional table with the same numbers.
export function GrowthView({ growth, goal }) {
  const [view, setView] = useState('daily');
  const [showTable, setShowTable] = useState(false);
  const current = growth.available.includes(view) ? view : 'daily';
  const points = growth.series[current];
  const currency = growth.currency;

  if (points.length === 0) {
    return (
      <section class="card">
        <h2 class="card-title">Evolución</h2>
        <p class="muted">
          Todavía no hay historial. Cada día se guarda automáticamente el valor de la cartera y el gráfico se va armando solo.
        </p>
      </section>
    );
  }

  const first = points[0].value;
  const last = points.at(-1).value;
  const change = last - first;
  const changePct = first ? (change / first) * 100 : null;
  const tone = change > 0 ? 'up' : change < 0 ? 'down' : '';

  return (
    <section class="card">
      <div class="card-head">
        <h2 class="card-title">Evolución</h2>
        {growth.available.length > 1 && (
          <Segmented
            label="Agrupar por"
            value={current}
            onChange={setView}
            options={growth.available.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
          />
        )}
      </div>

      {points.length > 1 ? (
        <p class="change">
          <span class={`change-value ${tone}`}>
            {fmtSignedMoney(change, currency)} ({fmtPct(changePct, { signed: true })})
          </span>
          <span class="muted"> desde el {fmtDate(points[0].date)}</span>
        </p>
      ) : (
        <p class="muted">Primer registro: el gráfico suma un punto por día.</p>
      )}

      <GrowthChart points={points} currency={currency} view={current} goal={goal} />

      <button type="button" class="link-btn" onClick={() => setShowTable(!showTable)}>
        {showTable ? 'Ocultar tabla' : 'Ver como tabla'}
      </button>
      {showTable && (
        <div class="table-wrap">
          <table class="table compact">
            <thead>
              <tr>
                <th>Fecha</th>
                <th class="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr>
                  <td>{fmtDate(p.date)}</td>
                  <td class="num">{fmtMoney(p.value, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
