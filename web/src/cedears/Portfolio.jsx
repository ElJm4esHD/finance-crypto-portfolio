import { useState } from 'preact/hooks';
import { fmtAmount, fmtMoney, fmtPct, fmtPrice, fmtSignedMoney } from '../format.js';
import { useApi } from '../hooks.js';
import { DayChange, EmptyState, ErrorMessage, Icon, Loading, PctChange, PriceNotice } from '../components/ui.jsx';
import { CashModal } from './CashModal.jsx';

const CURRENCIES = ['ARS', 'USD'];
const CURRENCY_NAME = { ARS: 'pesos', USD: 'dólares' };

// Each currency is shown on its own: no exchange rate, weights are within
// the positions of the same currency.
export function CedearPortfolio({ onNewOperation }) {
  const { data, error, loading } = useApi('/cedears/portfolio');
  const [cashModal, setCashModal] = useState(null); // currency preset

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  const { positions, cash, totals, priceSource } = data;
  const used = CURRENCIES.filter((c) => totals[c].used);
  const heroCurrencies = used.length ? used : CURRENCIES;

  return (
    <>
      <section class="hero">
        <p class="hero-label">
          Total de la cartera <PriceNotice source={priceSource.error ? null : priceSource} />
        </p>
        <div class="hero-totals">
          {heroCurrencies.map((c) => (
            <div>
              <p class="hero-value">{fmtMoney(totals[c].total, c)}</p>
              <DayChange change={totals[c].dayChange} pct={totals[c].dayChangePct} currency={c} />
            </div>
          ))}
        </div>
      </section>
      {priceSource.error && <PriceNotice source={priceSource} />}

      <section class="cash-grid" aria-label="Dinero disponible">
        {CURRENCIES.map((c) => (
          <div class="card cash-card">
            <p class="cash-label">Disponible en {c}</p>
            <p class="cash-value">{fmtMoney(cash[c], c)}</p>
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
          <PositionsTable currency={c} positions={positions.filter((p) => p.currency === c)} />
        ))
      )}

      {cashModal && <CashModal currency={cashModal} onClose={() => setCashModal(null)} />}
    </>
  );
}

function PositionsTable({ currency, positions }) {
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
                  {isClosed ? 'Cerrada' : p.value === null ? <span title="Sin precio: se muestra el costo">{fmtMoney(p.cost, currency)}*</span> : fmtMoney(p.value, currency)}
                </td>
                <td class="num" data-label="Hoy">{isClosed ? '—' : <PctChange value={p.dayChangePct} />}</td>
                <td class="num" data-label="Rendimiento">
                  {isClosed || p.pnlPct === null ? (
                    '—'
                  ) : (
                    <span class={`change-value ${tone}`}>
                      {fmtPct(p.pnlPct, { signed: true })}
                      <span class="small block">{fmtSignedMoney(p.pnl, currency)}</span>
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
