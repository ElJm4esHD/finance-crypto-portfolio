import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, fmtDate, fmtMoney, fmtPrice } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { EmptyState, ErrorMessage, Icon, Loading, Segmented } from '../components/ui.jsx';

export function CedearHistory() {
  const [kind, setKind] = useState('operations');
  return (
    <section class="card">
      <div class="card-head">
        <h2 class="card-title">Historial</h2>
        <Segmented
          label="Mostrar"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'operations', label: 'Compras y ventas' },
            { value: 'cash', label: 'Depósitos y retiros' },
          ]}
        />
      </div>
      {kind === 'operations' ? <Operations /> : <CashMovements />}
    </section>
  );
}

function Operations() {
  const { data, error, loading } = useApi('/cedears/operations');
  const { run, error: deleteError } = useMutation();
  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;
  if (data.length === 0) return <EmptyState title="Todavía no registraste compras ni ventas" />;

  async function remove(op) {
    const label = `${op.type === 'buy' ? 'la compra' : 'la venta'} de ${fmtAmount(op.quantity)} ${op.ticker} del ${fmtDate(op.date)}`;
    if (window.confirm(`¿Borrar ${label}?\n\nLa posición y el dinero disponible se recalculan.`)) {
      await run(() => api.del(`/cedears/operations/${op.id}`));
    }
  }

  return (
    <>
      <ErrorMessage>{deleteError}</ErrorMessage>
      <ul class="list">
        {data.map((op) => {
          const gross = op.quantity * op.price;
          const total = op.type === 'buy' ? gross + op.commission : gross - op.commission;
          return (
            <li class="list-row has-badge">
              <span class={`badge ${op.type === 'buy' ? 'badge-up' : 'badge-down'}`}>{op.type === 'buy' ? 'Compra' : 'Venta'}</span>
              <div class="list-main">
                <p>
                  <strong>{op.ticker}</strong> · {fmtAmount(op.quantity)} × {fmtPrice(op.price, op.currency)}
                </p>
                <p class="muted small">
                  {fmtDate(op.date)}
                  {op.commission > 0 && ` · comisión ${fmtMoney(op.commission, op.currency)}`}
                </p>
              </div>
              <p class="list-amount">
                {op.type === 'buy' ? '−' : '+'}
                {fmtMoney(total, op.currency)}
              </p>
              <button type="button" class="icon-btn" aria-label="Borrar operación" title="Borrar" onClick={() => remove(op)}>
                <Icon name="trash" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function CashMovements() {
  const { data, error, loading } = useApi('/cedears/cash-movements');
  const { run, error: deleteError } = useMutation();
  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;
  if (data.length === 0) return <EmptyState title="Todavía no cargaste depósitos" />;

  async function remove(m) {
    const label = `${m.type === 'deposit' ? 'el depósito' : 'el retiro'} de ${fmtMoney(m.amount, m.currency)} del ${fmtDate(m.date)}`;
    if (window.confirm(`¿Borrar ${label}?`)) await run(() => api.del(`/cedears/cash-movements/${m.id}`));
  }

  return (
    <>
      <ErrorMessage>{deleteError}</ErrorMessage>
      <ul class="list">
        {data.map((m) => (
          <li class="list-row has-badge">
            <span class={`badge ${m.type === 'deposit' ? 'badge-up' : 'badge-down'}`}>{m.type === 'deposit' ? 'Depósito' : 'Retiro'}</span>
            <div class="list-main">
              <p class="muted small">
                {fmtDate(m.date)}
                {m.note && ` · ${m.note}`}
              </p>
            </div>
            <p class="list-amount">
              {m.type === 'deposit' ? '+' : '−'}
              {fmtMoney(m.amount, m.currency)}
            </p>
            <button type="button" class="icon-btn" aria-label="Borrar movimiento" title="Borrar" onClick={() => remove(m)}>
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
