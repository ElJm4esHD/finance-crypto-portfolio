import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, fmtDateTime, fmtMoney } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { EmptyState, ErrorMessage, Icon, Loading, Segmented } from '../components/ui.jsx';

export function CryptoExchanges({ onNew }) {
  const [kind, setKind] = useState('exchanges');
  return (
    <section class="card">
      <div class="card-head">
        <h2 class="card-title">Historial</h2>
        <Segmented
          label="Mostrar"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'exchanges', label: 'Intercambios' },
            { value: 'flows', label: 'Aportes y retiros' },
          ]}
        />
      </div>
      {kind === 'exchanges' ? <Exchanges onNew={onNew} /> : <Flows />}
    </section>
  );
}

function Exchanges({ onNew }) {
  const { data, error, loading } = useApi('/crypto/exchanges');
  const { run, error: deleteError } = useMutation();

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  async function remove(ex) {
    const msg = `¿Borrar el intercambio de ${fmtAmount(ex.from_amount)} ${ex.from_asset} → ${fmtAmount(ex.to_amount)} ${ex.to_asset}?\n\nLos saldos vuelven a como estaban antes.`;
    if (window.confirm(msg)) await run(() => api.del(`/crypto/exchanges/${ex.id}`));
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title="Todavía no registraste intercambios"
        action={
          <button type="button" class="btn btn-primary" onClick={onNew}>
            <Icon name="plus" /> Nuevo movimiento
          </button>
        }
      >
        Cada vez que cambies una moneda por otra, registralo acá y tus saldos se actualizan solos.
      </EmptyState>
    );
  }

  return (
    <>
      <ErrorMessage>{deleteError}</ErrorMessage>
      <ul class="list">
        {data.map((ex) => (
          <li class="list-row">
            <div class="list-main">
              <p class="exchange">
                <span>
                  <strong>{fmtAmount(ex.from_amount)}</strong> {ex.from_asset}
                </span>
                <span class="exchange-arrow" aria-label="por">
                  <Icon name="arrow" />
                </span>
                <span>
                  <strong>{fmtAmount(ex.to_amount)}</strong> {ex.to_asset}
                </span>
              </p>
              <p class="muted small">
                {fmtDateTime(ex.executed_at)}
                {ex.fee_amount > 0 && ` · comisión ${fmtAmount(ex.fee_amount)} ${ex.fee_asset}`}
              </p>
            </div>
            <button type="button" class="icon-btn" aria-label="Borrar intercambio" title="Borrar" onClick={() => remove(ex)}>
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// Money put in or taken out: what counts as invested.
function Flows() {
  const { data, error, loading } = useApi('/crypto/flows');
  const { run, error: deleteError } = useMutation();

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;
  if (data.length === 0) {
    return (
      <EmptyState title="Todavía no registraste aportes ni retiros">
        Cuando pongas plata nueva (o la saques), registralo con Nuevo movimiento → Aporte o Retiro: así no se confunde con rendimiento.
      </EmptyState>
    );
  }

  async function remove(f) {
    const what = f.amount > 0 ? 'el aporte' : 'el retiro';
    if (window.confirm(`¿Borrar ${what} de ${fmtAmount(Math.abs(f.amount))} ${f.asset}?\n\nEl saldo vuelve a como estaba antes.`)) {
      await run(() => api.del(`/crypto/flows/${f.id}`));
    }
  }

  return (
    <>
      <ErrorMessage>{deleteError}</ErrorMessage>
      <ul class="list">
        {data.map((f) => (
          <li class="list-row has-badge">
            <span class="badge badge-flag">{f.amount > 0 ? 'Aporte' : 'Retiro'}</span>
            <div class="list-main">
              <p>
                <strong>{fmtAmount(Math.abs(f.amount))}</strong> {f.asset}
              </p>
              <p class="muted small">{fmtDateTime(f.executed_at)}</p>
            </div>
            <p class="list-amount">
              {f.amount > 0 ? '+' : '−'}
              {fmtMoney(Math.abs(f.value_usdt), 'USDT')}
            </p>
            <button type="button" class="icon-btn" aria-label="Borrar movimiento" title="Borrar" onClick={() => remove(f)}>
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
