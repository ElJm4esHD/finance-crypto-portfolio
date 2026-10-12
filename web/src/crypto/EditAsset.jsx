import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, fmtDateTime, fmtMoney, parseNumber, toInputValue } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { ErrorMessage, Field, Icon, Loading, Modal } from '../components/ui.jsx';
import { CORRECTION_NOTE, EditRow } from '../components/EditRow.jsx';

const num = (raw, label, { optional = false } = {}) => {
  if (optional && String(raw ?? '').trim() === '') return null;
  const n = parseNumber(raw);
  if (n === null || Number.isNaN(n)) throw new Error(`${label}: ingresá un número válido.`);
  return n;
};

// "Editar" of a coin: rename it, correct its balance, and fix the exchanges
// and contributions it is part of. Corrections, not transactions.
// holding: { asset, amount } — { asset: '' } adds a missing coin.
export function EditAsset({ holding, onClose }) {
  const isNew = !holding.asset;
  const [name, setName] = useState(holding.asset);
  const [amount, setAmount] = useState(isNew ? '' : toInputValue(holding.amount));
  const { run, busy, error, setError } = useMutation();
  const exchanges = useApi('/crypto/exchanges');
  const flows = useApi('/crypto/flows');

  async function save(e) {
    e.preventDefault();
    const target = name.trim().toUpperCase();
    const n = parseNumber(amount);
    if (!target) return setError('Falta la moneda.');
    if (n === null || Number.isNaN(n) || n < 0) return setError('Ingresá una cantidad válida.');
    const { ok } = await run(async () => {
      if (!isNew && target !== holding.asset) await api.put(`/crypto/assets/${encodeURIComponent(holding.asset)}`, { asset: target });
      if (isNew || n !== holding.amount) await api.put('/crypto/holdings', { asset: target, amount: n });
    });
    if (ok) onClose();
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar ${holding.asset}? Se corrige como si nunca la hubieras tenido; el historial de intercambios no se borra.`)) return;
    const { ok } = await run(() => api.del(`/crypto/holdings/${encodeURIComponent(holding.asset)}`));
    if (ok) onClose();
  }

  const exs = (exchanges.data ?? []).filter((x) => [x.from_asset, x.to_asset, x.fee_asset].includes(holding.asset));
  const fls = (flows.data ?? []).filter((f) => f.asset === holding.asset);

  return (
    <Modal title={isNew ? 'Agregar moneda' : `Editar ${holding.asset}`} onClose={onClose}>
      <div class="form">
        <p class="form-note">{CORRECTION_NOTE} Para registrar plata nueva usá Nuevo movimiento → Aporte.</p>

        <form class="form" onSubmit={save}>
          <div class="form-row">
            <Field label="Moneda" hint={isNew ? 'El ticker, por ejemplo BTC, ETH o USDT.' : 'Cambiarla la renombra también en el historial.'}>
              <input value={name} onInput={(e) => setName(e.currentTarget.value.toUpperCase())} required maxLength={20} autocomplete="off" autofocus={isNew} />
            </Field>
            <Field label="Cantidad que tenés hoy">
              <input value={amount} onInput={(e) => setAmount(e.currentTarget.value)} inputMode="decimal" placeholder="0,00" autocomplete="off" required />
            </Field>
          </div>
          <ErrorMessage>{error}</ErrorMessage>
          <div class="form-actions">
            {!isNew && (
              <button type="button" class="btn btn-danger-text" onClick={remove} disabled={busy}>
                Eliminar moneda
              </button>
            )}
            <button type="submit" class="btn btn-primary btn-sm" disabled={busy}>
              Guardar
            </button>
          </div>
        </form>

        {!isNew && (
          <div>
            <p class="field-label">Operaciones con {holding.asset}</p>
            {exchanges.loading || flows.loading ? (
              <Loading />
            ) : exs.length + fls.length === 0 ? (
              <p class="muted small">No hay intercambios ni aportes con esta moneda.</p>
            ) : (
              <ul class="edit-list">
                {fls.map((f) => (
                  <EditRow
                    key={`f${f.id}`}
                    badge={<span class="badge badge-flag">{f.amount > 0 ? 'Aporte' : 'Retiro'}</span>}
                    summary={
                      <>
                        {fmtAmount(Math.abs(f.amount))} {f.asset} · {fmtMoney(Math.abs(f.value_usdt), 'USDT')}
                        <span class="muted small block">{fmtDateTime(f.executed_at)}</span>
                      </>
                    }
                    fields={[
                      { key: 'amount', label: 'Cantidad', initial: toInputValue(Math.abs(f.amount)) },
                      { key: 'valueUsdt', label: 'Valor en USDT', initial: toInputValue(Math.abs(f.value_usdt)) },
                      { key: 'executedAt', label: 'Fecha y hora', type: 'datetime-local', initial: f.executed_at },
                    ]}
                    save={(v) =>
                      api.put(`/crypto/flows/${f.id}`, { amount: num(v.amount, 'Cantidad'), valueUsdt: num(v.valueUsdt, 'Valor'), executedAt: v.executedAt })
                    }
                  />
                ))}
                {exs.map((x) => (
                  <EditRow
                    key={`x${x.id}`}
                    badge={<span class="badge">Intercambio</span>}
                    summary={
                      <>
                        {fmtAmount(x.from_amount)} {x.from_asset} <Icon name="arrow" /> {fmtAmount(x.to_amount)} {x.to_asset}
                        <span class="muted small block">
                          {fmtDateTime(x.executed_at)}
                          {x.fee_amount > 0 && ` · comisión ${fmtAmount(x.fee_amount)} ${x.fee_asset}`}
                        </span>
                      </>
                    }
                    fields={[
                      { key: 'fromAmount', label: `Entregaste (${x.from_asset})`, initial: toInputValue(x.from_amount) },
                      { key: 'toAmount', label: `Recibiste (${x.to_asset})`, initial: toInputValue(x.to_amount) },
                      { key: 'feeAmount', label: `Comisión${x.fee_asset ? ` (${x.fee_asset})` : ''}`, initial: x.fee_amount ? toInputValue(x.fee_amount) : '', optional: true },
                      { key: 'executedAt', label: 'Fecha y hora', type: 'datetime-local', initial: x.executed_at },
                    ]}
                    save={(v) =>
                      api.put(`/crypto/exchanges/${x.id}`, {
                        fromAmount: num(v.fromAmount, 'Entregaste'),
                        toAmount: num(v.toAmount, 'Recibiste'),
                        feeAmount: num(v.feeAmount, 'Comisión', { optional: true }),
                        feeAsset: x.fee_asset ?? x.from_asset,
                        executedAt: v.executedAt,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
