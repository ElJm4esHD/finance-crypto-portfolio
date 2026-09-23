import { useState } from 'preact/hooks';
import { fmtAmount, fmtMoney, fmtPct, fmtPrice, fmtSignedMoney } from '../format.js';
import { useApi } from '../hooks.js';
import { EmptyState, ErrorMessage, Icon, Loading, PriceNotice } from '../components/ui.jsx';
import { CashModal } from './CashModal.jsx';

export function CedearPortfolio({ onNewOperation }) {
  const { data, error, loading } = useApi('/cedears/portfolio');
  const [cashModal, setCashModal] = useState(null); // currency preset

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  const { positions, cash, totals, fx, priceSource } = data;
  const open = positions.filter((p) => p.quantity > 0);
  const closed = positions.filter((p) => p.quantity === 0);

  return (
    <>
      <section class="hero">
        <p class="hero-label">
          Total de la cartera <PriceNotice source={priceSource.error ? null : priceSource} />
        </p>
        <p class="hero-value">{fmtMoney(totals.totalUsd, 'USD')}</p>
        {fx && (
          <p class="muted">
            ≈ {fmtMoney(totals.totalUsd * fx, 'ARS')} · dólar a {fmtMoney(fx, 'ARS')}
          </p>
        )}
      </section>
      {priceSource.error && <PriceNotice source={priceSource} />}

      <section class="cash-grid" aria-label="Dinero disponible">
        {['USD', 'ARS'].map((c) => (
          <div class="card cash-card">
            <p class="cash-label">Disponible en {c}</p>
            <p class="cash-value">{fmtMoney(cash[c], c)}</p>
            <button type="button" class="btn btn-secondary btn-sm" onClick={() => setCashModal(c)}>
              Depositar o retirar
            </button>
          </div>
        ))}
      </section>

      <section class="card">
        <h2 class="card-title">Posiciones</h2>
        {positions.length === 0 ? (
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
        ) : (
          <table class="table responsive">
            <thead>
              <tr>
                <th>Ticker</th>
                <th class="num">Cantidad</th>
                <th class="num">Precio prom.</th>
                <th class="num">Precio actual</th>
                <th class="num">Valor</th>
                <th class="num">Rendimiento</th>
                <th class="num">Peso</th>
              </tr>
            </thead>
            <tbody>
              {[...open, ...closed].map((p) => {
                const isClosed = p.quantity === 0;
                const tone = p.pnl > 0 ? 'up' : p.pnl < 0 ? 'down' : '';
                return (
                  <tr class={isClosed ? 'dimmed' : ''}>
                    <td class="ticker" data-label="Ticker">
                      {p.ticker} <span class="tag">{p.currency}</span>
                    </td>
                    <td class="num" data-label="Cantidad">{fmtAmount(p.quantity)}</td>
                    <td class="num secondary" data-label="Precio prom.">{fmtPrice(p.avgPrice, p.currency)}</td>
                    <td class="num secondary" data-label="Precio actual">{isClosed ? '—' : fmtPrice(p.price, p.currency)}</td>
                    <td class="num strong" data-label="Valor">
                      {isClosed ? 'Cerrada' : p.value === null ? <span title="Sin precio: se muestra el costo">{fmtMoney(p.cost, p.currency)}*</span> : fmtMoney(p.value, p.currency)}
                    </td>
                    <td class="num" data-label="Rendimiento">
                      {isClosed || p.pnlPct === null ? (
                        '—'
                      ) : (
                        <span class={`change-value ${tone}`}>
                          {fmtPct(p.pnlPct, { signed: true })}
                          <span class="small block">{fmtSignedMoney(p.pnl, p.currency)}</span>
                        </span>
                      )}
                    </td>
                    <td class="num" data-label="Peso">{isClosed ? '—' : fmtPct(p.weight)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {cashModal && <CashModal currency={cashModal} onClose={() => setCashModal(null)} />}
    </>
  );
}
