import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, fmtMoney, parseNumber, todayIso } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { ErrorMessage, Field, Modal, Segmented } from '../components/ui.jsx';

// Single form for both buys and sells.
export function OperationModal({ onClose }) {
  const { data: portfolio } = useApi('/cedears/portfolio');
  const [form, setForm] = useState({ type: 'buy', ticker: '', quantity: '', price: '', currency: 'USD', commission: '', date: todayIso() });
  const { run, busy, error, setError } = useMutation();
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const positions = portfolio?.positions ?? [];
  const ticker = form.ticker.trim();

  function onTicker(value) {
    const upper = value.toUpperCase();
    // Picking a known ticker selects its currency automatically.
    const match = positions.filter((p) => p.ticker === upper.trim());
    setForm((f) => ({ ...f, ticker: upper, currency: match.length === 1 ? match[0].currency : f.currency }));
  }

  const quantity = parseNumber(form.quantity);
  const price = parseNumber(form.price);
  const commission = parseNumber(form.commission) ?? 0;
  const valid = [quantity, price, commission].every((n) => n !== null && Number.isFinite(n));
  const gross = valid ? quantity * price : null;
  const total = gross === null ? null : form.type === 'buy' ? gross + commission : gross - commission;
  const available = portfolio?.cash[form.currency];
  const held = positions.find((p) => p.ticker === ticker && p.currency === form.currency)?.quantity ?? 0;

  async function submit(e) {
    e.preventDefault();
    if (!valid) return setError('Revisá cantidad, precio y comisión: tienen que ser números.');
    const { ok } = await run(() => api.post('/cedears/operations', { ...form, quantity, price, commission }));
    if (ok) onClose();
  }

  return (
    <Modal title="Nueva operación" onClose={onClose}>
      <form onSubmit={submit} class="form">
        <Segmented
          label="Tipo de operación"
          size="lg"
          value={form.type}
          onChange={set('type')}
          options={[
            { value: 'buy', label: 'Compra', tone: 'up' },
            { value: 'sell', label: 'Venta', tone: 'down' },
          ]}
        />

        <datalist id="cedear-tickers">
          {[...new Set(positions.map((p) => p.ticker))].map((t) => (
            <option value={t} />
          ))}
        </datalist>

        <div class="form-row">
          <Field label="Ticker" hint={form.type === 'sell' && ticker ? `Tenés ${fmtAmount(held)} en ${form.currency}` : undefined}>
            <input value={form.ticker} onInput={(e) => onTicker(e.currentTarget.value)} list="cedear-tickers" placeholder="AAPL.BA" autocomplete="off" required autofocus maxLength={20} />
          </Field>
          <Field label="Moneda">
            <Segmented label="Moneda" value={form.currency} onChange={set('currency')} options={[{ value: 'USD', label: 'USD' }, { value: 'ARS', label: 'ARS' }]} />
          </Field>
        </div>

        <div class="form-row">
          <Field label="Cantidad">
            <input value={form.quantity} onInput={(e) => set('quantity')(e.currentTarget.value)} inputMode="decimal" placeholder="0" autocomplete="off" required />
          </Field>
          <Field label="Precio por unidad">
            <input value={form.price} onInput={(e) => set('price')(e.currentTarget.value)} inputMode="decimal" placeholder="0,00" autocomplete="off" required />
          </Field>
        </div>

        <div class="form-row">
          <Field label="Comisión">
            <input value={form.commission} onInput={(e) => set('commission')(e.currentTarget.value)} inputMode="decimal" placeholder="0,00" autocomplete="off" />
          </Field>
          <Field label="Fecha">
            <input type="date" value={form.date} onInput={(e) => set('date')(e.currentTarget.value)} required />
          </Field>
        </div>

        <div class="summary">
          <div>
            <span class="muted">{form.type === 'buy' ? 'Total a pagar' : 'Total a cobrar'}</span>
            <strong>{total === null ? '—' : fmtMoney(total, form.currency)}</strong>
          </div>
          <div>
            <span class="muted">Disponible en {form.currency}</span>
            <strong class={form.type === 'buy' && total !== null && available !== undefined && total > available + 1e-9 ? 'text-down' : ''}>
              {available === undefined ? '—' : fmtMoney(available, form.currency)}
            </strong>
          </div>
        </div>

        <ErrorMessage>{error}</ErrorMessage>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" class="btn btn-primary" disabled={busy}>
            {form.type === 'buy' ? 'Guardar compra' : 'Guardar venta'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
