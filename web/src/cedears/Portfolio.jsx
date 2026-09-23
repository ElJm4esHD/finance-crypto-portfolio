import { useState } from 'preact/hooks';
import { fmtAmount, fmtMoney, fmtPct, fmtPrice, fmtSignedMoney } from '../format.js';
import { useApi, useStoredState } from '../hooks.js';
import { DayChange, EmptyState, ErrorMessage, Icon, Loading, PctChange, PriceNotice } from '../components/ui.jsx';
import { convert, DisplayCurrency, MepNote, Money, shownCurrency } from '../components/money.jsx';
import { CashModal } from './CashModal.jsx';

const CURRENCIES = ['ARS', 'USD'];
const CURRENCY_NAME = { ARS: 'pesos', USD: 'dólares' };

// Whole portfolio (both currencies) expressed in `currency` with the dólar MEP.
function consolidated(totals, currency, rate) {
  const total = CURRENCIES.reduce((s, c) => s + convert(totals[c].total, c, currency, rate), 0);
  const withDay = CURRENCIES.filter((c) => totals[c].dayChange !== null);
  if (withDay.length === 0) return { total, dayChange: null, dayChangePct: null };
  const dayChange = withDay.reduce((s, c) => s + convert(totals[c].dayChange, c, currency, rate), 0);
  const previous = total - dayChange;
  return { total, dayChange, dayChangePct: previous > 0 ? (dayChange / previous) * 100 : null };
}

// Positions stay grouped by their currency (weights are within it). The
// totals are converted with the dólar MEP to the currency picked: ARS, USD
// or both. Without a rate each currency is shown on its own.
export function CedearPortfolio({ onNewOperation }) {
  const { data, error, loading } = useApi('/cedears/portfolio');
  const [cashModal, setCashModal] = useState(null); // currency preset
  const [display, setDisplay] = useStoredState('display-currency:cedears', 'both');

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  const { positions, cash, totals, priceSource } = data;
  const rate = data.fx?.rate ?? null;
  const used = CURRENCIES.filter((c) => totals[c].used);
  const heroCurrencies = rate ? (display === 'both' ? CURRENCIES : [display]) : used.length ? used : CURRENCIES;
  const heroFigure = (c) => (rate ? consolidated(totals, c, rate) : totals[c]);

  return (
    <>
      <section class="hero">
        <p class="hero-label">
          Total de la cartera <PriceNotice source={priceSource} />
          <DisplayCurrency value={display} onChange={setDisplay} />
        </p>
        <div class="hero-totals">
          {heroCurrencies.map((c) => {
            const f = heroFigure(c);
            return (
              <div>
                <p class="hero-value">{fmtMoney(f.total, c)}</p>
                <DayChange change={f.dayChange} pct={f.dayChangePct} currency={c} />
              </div>
            );
          })}
        </div>
        <MepNote fx={data.fx} />
      </section>

      <section class="cash-grid" aria-label="Dinero disponible">
        {CURRENCIES.map((c) => (
          <div class="card cash-card">
            <p class="cash-label">Disponible en {c}</p>
            <p class="cash-value">{fmtMoney(cash[c], c)}</p>
            {rate && display !== c && (
              <p class="cash-converted">≈ {fmtMoney(convert(cash[c], c, c === 'ARS' ? 'USD' : 'ARS', rate), c === 'ARS' ? 'USD' : 'ARS')}</p>
            )}
            <button type="button" class="btn btn-secondary btn-sm" onClick={() => setCashModal(c)}>
              Depositar o retirar
            </button>
          </div>
        ))}
      </section>

      {positions.length === 0 ? (
        <section class="card">
          <h2 class="card-title">Posiciones</h2>
          <EmptyState
            title="Todavía no tenés posiciones"
            action={
              <button type="button" class="btn btn-primary" onClick={onNewOperation}>
                <Icon name="plus" /> Nueva operación
              </button>
            }
          >
            Primero cargá un depósito en USD o ARS y después registrá tus compras.
          </EmptyState>
        </section>
      ) : (
        CURRENCIES.filter((c) => positions.some((p) => p.currency === c)).map((c) => (
          <PositionsTable
            currency={c}
            positions={positions.filter((p) => p.currency === c)}
            display={rate ? display : c}
            rate={rate}
          />
        ))
      )}

      {cashModal && <CashModal currency={cashModal} onClose={() => setCashModal(null)} />}
    </>
  );
}

// Prices stay in the position's currency; value and return follow `display`.
function PositionsTable({ currency, positions, display, rate }) {
  const moneyIn = shownCurrency(display, currency, rate);
  return (
    <section class="card">
      <h2 class="card-title">Posiciones en {CURRENCY_NAME[currency]}</h2>
      <table class="table responsive">
        <thead>
          <tr>
            <th>Ticker</th>
            <th class="num">Cantidad</th>
            <th class="num">Precio prom.</th>
            <th class="num">Precio actual</th>
            <th class="num">Valor</th>
            <th class="num">Hoy</th>
            <th class="num">Rendimiento</th>
            <th class="num">Peso</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const isClosed = p.quantity === 0;
            const tone = p.pnl > 0 ? 'up' : p.pnl < 0 ? 'down' : '';
            return (
              <tr class={isClosed ? 'dimmed' : ''}>
                <td class="ticker" data-label="Ticker">{p.ticker}</td>
                <td class="num" data-label="Cantidad">{fmtAmount(p.quantity)}</td>
                <td class="num secondary" data-label="Precio prom.">{fmtPrice(p.avgPrice, currency)}</td>
                <td class="num secondary" data-label="Precio actual">{isClosed ? '—' : fmtPrice(p.price, currency)}</td>
                <td class="num strong" data-label="Valor">
                  {isClosed ? (
                    'Cerrada'
                  ) : p.value === null ? (
                    <span title="Sin precio: se muestra el costo">
                      <Money amount={p.cost} currency={currency} display={display} rate={rate} />*
                    </span>
                  ) : (
                    <Money amount={p.value} currency={currency} display={display} rate={rate} />
                  )}
                </td>
                <td class="num" data-label="Hoy">{isClosed ? '—' : <PctChange value={p.dayChangePct} />}</td>
                <td class="num" data-label="Rendimiento">
                  {isClosed || p.pnlPct === null ? (
                    '—'
                  ) : (
                    <span class={`change-value ${tone}`}>
                      {fmtPct(p.pnlPct, { signed: true })}
                      <span class="small block">{fmtSignedMoney(convert(p.pnl, currency, moneyIn, rate), moneyIn)}</span>
                    </span>
                  )}
                </td>
                <td class="num" data-label="Peso">{isClosed ? '—' : fmtPct(p.weight)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
