import { api } from '../api.js';
import { fmtAmount, fmtDateTime } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { EmptyState, ErrorMessage, Icon, Loading } from '../components/ui.jsx';

export function CryptoExchanges({ onNew }) {
  const { data, error, loading } = useApi('/crypto/exchanges');
  const { run, error: deleteError } = useMutation();

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  async function remove(ex) {
    const msg = `¿Borrar el intercambio de ${fmtAmount(ex.from_amount)} ${ex.from_asset} → ${fmtAmount(ex.to_amount)} ${ex.to_asset}?\n\nLos saldos vuelven a como estaban antes.`;
    if (window.confirm(msg)) await run(() => api.del(`/crypto/exchanges/${ex.id}`));
  }

  return (
    <section class="card">
      <h2 class="card-title">Historial de intercambios</h2>
      <ErrorMessage>{deleteError}</ErrorMessage>
      {data.length === 0 ? (
        <EmptyState
          title="Todavía no registraste intercambios"
          action={
            <button type="button" class="btn btn-primary" onClick={onNew}>
              <Icon name="plus" /> Nuevo intercambio
            </button>
          }
        >
          Cada vez que cambies una moneda por otra, registralo acá y tus saldos se actualizan solos.
        </EmptyState>
      ) : (
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
      )}
    </section>
  );
}
