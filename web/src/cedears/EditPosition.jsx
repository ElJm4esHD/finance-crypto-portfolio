import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, fmtDate, fmtMoney, fmtPrice, parseNumber, toInputValue } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { ErrorMessage, Field, Loading, Modal, Segmented } from '../components/ui.jsx';
import { CORRECTION_NOTE, EditRow } from '../components/EditRow.jsx';

const num = (raw, label) => {
  const n = parseNumber(raw);
  if (n === null || Number.isNaN(n)) throw new Error(`${label}: ingresá un número válido.`);
  return n;
};

// "Editar" of a CEDEAR/ETF position: rename it or move it to the other
// currency, and fix each of its operations. Corrections, not transactions.
export function EditPosition({ ticker, currency, onClose }) {
  const { data: operations, loading } = useApi('/cedears/operations');
  const [name, setName] = useState(ticker);
  const [cur, setCur] = useState(currency);
  const { run, busy, error } = useMutation();
  const ops = (operations ?? []).filter((o) => o.ticker === ticker && o.currency === currency);
  const changed = name.trim().toUpperCase() !== ticker || cur !== currency;

  async function rename(e) {
    e.preventDefault();
    const { ok } = await run(() => api.put('/cedears/positions', { ticker, currency, newTicker: name, newCurrency: cur }));
    if (ok) onClose();
  }

  return (
    <Modal title={`Editar ${ticker}`} onClose={onClose}>
      <div class="form">
        <p class="form-note">{CORRECTION_NOTE}</p>

        <form class="form" onSubmit={rename}>
          <div class="form-row">
            <Field label="Ticker" hint="Por ejemplo, si cargaste SPYD y era SPY.">
              <input value={name} onInput={(e) => setName(e.currentTarget.value.toUpperCase())} required maxLength={20} autocomplete="off" />
            </Field>
            <Field label="Moneda">
              <Segmented label="Moneda" value={cur} onChange={setCur} options={[{ value: 'USD', label: 'USD' }, { value: 'ARS', label: 'ARS' }]} />
            </Field>
          </div>
          <ErrorMessage>{error}</ErrorMessage>
          {changed && (
            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-sm" disabled={busy}>
                Cambiar en todas las operaciones
              </button>
            </div>
          )}
        </form>

        <div>
          <p class="field-label">Operaciones</p>
          {loading ? (
            <Loading />
          ) : (
            <ul class="edit-list">
              {ops.map((op) => (
                <EditRow
                  key={op.id}
                  badge={<span class={`badge ${op.type === 'buy' ? 'badge-up' : 'badge-down'}`}>{op.type === 'buy' ? 'Compra' : 'Venta'}</span>}
                  summary={
                    <>
                      {fmtAmount(op.quantity)} × {fmtPrice(op.price, op.currency)}
                      <span class="muted small block">
                        {fmtDate(op.date)}
                        {op.commission > 0 && ` · comisión ${fmtMoney(op.commission, op.currency)}`}
                      </span>
                    </>
                  }
                  fields={[
                    { key: 'quantity', label: 'Cantidad', initial: toInputValue(op.quantity) },
                    { key: 'price', label: 'Precio', initial: toInputValue(op.price) },
                    { key: 'commission', label: 'Comisión', initial: toInputValue(op.commission), optional: true },
                    { key: 'date', label: 'Fecha', type: 'date', initial: op.date },
                  ]}
                  save={(v) =>
                    api.put(`/cedears/operations/${op.id}`, {
                      ticker: op.ticker,
                      currency: op.currency,
                      quantity: num(v.quantity, 'Cantidad'),
                      price: num(v.price, 'Precio'),
                      commission: v.commission === '' ? 0 : num(v.commission, 'Comisión'),
                      date: v.date,
                    })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Sets the available cash to its real amount: no deposit or withdrawal is
// recorded and the performance does not change.
export function EditCash({ cash, onClose }) {
  const [values, setValues] = useState({ USD: toInputValue(cash.USD), ARS: toInputValue(cash.ARS) });
  const { run, busy, error, setError } = useMutation();

  async function save(e) {
    e.preventDefault();
    const body = {};
    for (const c of ['USD', 'ARS']) {
      const n = parseNumber(values[c]);
      if (n === null || Number.isNaN(n) || n < 0) return setError(`Disponible en ${c}: ingresá un monto válido.`);
      body[c] = n;
    }
    const { ok } = await run(() => api.put('/cedears/cash', body));
    if (ok) onClose();
  }

  return (
    <Modal title="Corregir disponible" onClose={onClose}>
      <form class="form" onSubmit={save}>
        <p class="form-note">
          Poné el disponible en su valor real sin registrar un depósito ni un retiro. Lo invertido se ajusta por la misma diferencia (como si esa
          plata nunca hubiera estado), así que el rendimiento no cambia.
        </p>
        <div class="form-row">
          <Field label="Dólares (USD)">
            <input value={values.USD} onInput={(e) => setValues((v) => ({ ...v, USD: e.currentTarget.value }))} inputMode="decimal" autocomplete="off" required />
          </Field>
          <Field label="Pesos (ARS)">
            <input value={values.ARS} onInput={(e) => setValues((v) => ({ ...v, ARS: e.currentTarget.value }))} inputMode="decimal" autocomplete="off" required />
          </Field>
        </div>
        <ErrorMessage>{error}</ErrorMessage>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" class="btn btn-primary" disabled={busy}>
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}
