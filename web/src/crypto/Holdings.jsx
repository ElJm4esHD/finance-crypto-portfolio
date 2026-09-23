import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, fmtMoney, fmtPrice, parseNumber, toInputValue } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { DayChange, EmptyState, ErrorMessage, Field, Icon, Loading, Modal, PctChange, PriceNotice } from '../components/ui.jsx';
import { GoalProgress } from './GoalProgress.jsx';

export function CryptoHoldings() {
  const { data, error, loading } = useApi('/crypto/holdings');
  const [editing, setEditing] = useState(null); // { asset, amount } | { asset: '' } for a new one
  const [showEmpty, setShowEmpty] = useState(false);

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  const withBalance = data.holdings.filter((h) => h.amount > 0);
  const empty = data.holdings.filter((h) => h.amount === 0);
  const rows = showEmpty ? [...withBalance, ...empty] : withBalance;

  return (
    <>
      <section class="hero">
        <p class="hero-label">
          Valor total <PriceNotice source={data.priceSource.error ? null : data.priceSource} />
        </p>
        <p class="hero-value">{fmtMoney(data.total, 'USDT')}</p>
        <DayChange change={data.dayChange} pct={data.dayChangePct} currency="USDT" />
        {data.goal && <GoalProgress total={data.total} goal={data.goal} compact />}
      </section>
      {data.priceSource.error && <PriceNotice source={data.priceSource} />}

      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Monedas</h2>
          <button type="button" class="btn btn-secondary" onClick={() => setEditing({ asset: '' })}>
            <Icon name="plus" /> Agregar moneda
          </button>
        </div>

        {data.holdings.length === 0 ? (
          <EmptyState title="Todavía no cargaste saldos">
            Agregá cada moneda con la cantidad que tenés hoy. Después, cada intercambio los actualiza solo.
          </EmptyState>
        ) : (
          <>
            <table class="table responsive">
              <thead>
                <tr>
                  <th>Moneda</th>
                  <th class="num">Cantidad</th>
                  <th class="num">Precio</th>
                  <th class="num">Valor</th>
                  <th class="num">Hoy</th>
                  <th class="actions" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr class={h.amount === 0 ? 'dimmed' : ''}>
                    <td class="ticker" data-label="Moneda">{h.asset}</td>
                    <td class="num" data-label="Cantidad">{fmtAmount(h.amount)}</td>
                    <td class="num secondary" data-label="Precio">{h.amount > 0 ? fmtPrice(h.price, 'USDT') : '—'}</td>
                    <td class="num strong" data-label="Valor">{h.value === null ? (h.amount > 0 ? 'Sin precio' : '—') : fmtMoney(h.value, 'USDT')}</td>
                    <td class="num" data-label="Hoy">{h.amount > 0 ? <PctChange value={h.dayChangePct} /> : '—'}</td>
                    <td class="actions">
                      <button type="button" class="icon-btn" aria-label={`Corregir saldo de ${h.asset}`} title="Corregir saldo" onClick={() => setEditing(h)}>
                        <Icon name="edit" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {empty.length > 0 && (
              <button type="button" class="link-btn" onClick={() => setShowEmpty(!showEmpty)}>
                {showEmpty ? 'Ocultar monedas sin saldo' : `Mostrar monedas sin saldo (${empty.length})`}
              </button>
            )}
          </>
        )}
      </section>

      {editing && <HoldingModal holding={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function HoldingModal({ holding, onClose }) {
  const isNew = !holding.asset;
  const [asset, setAsset] = useState(holding.asset);
  const [amount, setAmount] = useState(isNew ? '' : toInputValue(holding.amount));
  const { run, busy, error, setError } = useMutation();

  async function save(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (n === null || Number.isNaN(n)) return setError('Ingresá una cantidad válida.');
    const { ok } = await run(() => api.put('/crypto/holdings', { asset, amount: n }));
    if (ok) onClose();
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar ${holding.asset} de la lista? El historial de intercambios no se borra.`)) return;
    const { ok } = await run(() => api.del(`/crypto/holdings/${encodeURIComponent(holding.asset)}`));
    if (ok) onClose();
  }

  return (
    <Modal title={isNew ? 'Agregar moneda' : `Corregir saldo de ${holding.asset}`} onClose={onClose}>
      <form onSubmit={save} class="form">
        {isNew && (
          <Field label="Moneda" hint="El ticker, por ejemplo BTC, ETH o USDT.">
            <input value={asset} onInput={(e) => setAsset(e.currentTarget.value.toUpperCase())} autofocus required maxLength={20} autocomplete="off" />
          </Field>
        )}
        <Field label="Cantidad que tenés hoy">
          <input value={amount} onInput={(e) => setAmount(e.currentTarget.value)} inputMode="decimal" autocomplete="off" required autofocus={!isNew} placeholder="0,00" />
        </Field>
        <ErrorMessage>{error}</ErrorMessage>
        <div class="form-actions">
          {!isNew && (
            <button type="button" class="btn btn-danger-text" onClick={remove} disabled={busy}>
              Eliminar moneda
            </button>
          )}
          <button type="submit" class="btn btn-primary" disabled={busy}>
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}
