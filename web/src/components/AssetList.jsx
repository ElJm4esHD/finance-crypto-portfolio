import { useState } from 'preact/hooks';
import { ChangeChip, toneOf } from './ui.jsx';
import { Sparkline } from './Sparkline.jsx';
import { IntradayChart } from './IntradayChart.jsx';

// "AAPL.BA" → "AAPL": the initials shown in the round badge.
const initials = (symbol) => symbol.replace(/\.[A-Z]+$/, '').slice(0, 4);

// Market-style list: symbol, trend of the day, price and day change. Tapping
// a row opens its details (`detail`, the figures of the old table) and the
// intraday price chart. rows: [{ key, symbol, label?, sub, price,
// dayChangePct, spark, detail, actions, dimmed }]; `symbol` is what the
// chart is asked for, `label` (default: symbol) what is shown.
export function AssetList({ kind, rows }) {
  const [open, setOpen] = useState(null);
  return (
    <ul class="assets">
      {rows.map((r) => {
        const isOpen = open === r.key;
        return (
          <li class={`asset ${isOpen ? 'open' : ''} ${r.dimmed ? 'dimmed' : ''}`}>
            <button
              type="button"
              class="asset-row"
              aria-expanded={isOpen}
              title={isOpen ? 'Cerrar' : `Ver detalle y gráfico de ${r.label ?? r.symbol}`}
              onClick={() => setOpen(isOpen ? null : r.key)}
            >
              <span class="asset-icon" aria-hidden="true">
                {initials(r.symbol)}
              </span>
              <span class="asset-name">
                <span class="asset-symbol">{r.label ?? r.symbol}</span>
                <span class="asset-sub">{r.sub}</span>
              </span>
              <Sparkline values={r.spark} tone={toneOf(r.dayChangePct)} />
              <span class="asset-quote">
                <span class="asset-price">{r.price}</span>
                <ChangeChip pct={r.dayChangePct} />
              </span>
            </button>
            {isOpen && (
              <div class="asset-detail">
                <dl class="details">
                  {r.detail.map(([label, value]) => (
                    <div>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {!r.dimmed && <IntradayChart kind={kind} symbol={r.symbol} />}
                {r.actions && <div class="asset-detail-actions">{r.actions}</div>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
