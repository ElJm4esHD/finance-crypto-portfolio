import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { parseNumber, todayIso } from '../format.js';
import { useMutation } from '../hooks.js';
import { ErrorMessage, Field, Modal, Segmented } from '../components/ui.jsx';

export function CashModal({ currency: initialCurrency = 'USD', onClose }) {
  const [form, setForm] = useState({ type: 'deposit', currency: initialCurrency, amount: '', date: todayIso(), note: '' });
  const { run, busy, error, setError } = useMutation();
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    const amount = parseNumber(form.amount);
    if (amount === null || Number.isNaN(amount) || amount <= 0) return setError('Ingresá un monto mayor a 0.');
    const { ok } = await run(() => api.post('/cedears/cash-movements', { ...form, amount }));
    if (ok) onClose();
  }

  return (
    <Modal title="Dinero disponible" onClose={onClose}>
      <form onSubmit={submit} class="form">
        <Segmented
          label="Tipo de movimiento"
          size="lg"
          value={form.type}
          onChange={set('type')}
          options={[
            { value: 'deposit', label: 'Depósito', tone: 'up' },
            { value: 'withdrawal', label: 'Retiro', tone: 'down' },
          ]}
        />
        <div class="form-row">
          <Field label="Monto">
            <input value={form.amount} onInput={(e) => set('amount')(e.currentTarget.value)} inputMode="decimal" placeholder="0,00" autocomplete="off" required autofocus />
          </Field>
          <Field label="Moneda">
            <Segmented label="Moneda" value={form.currency} onChange={set('currency')} options={[{ value: 'USD', label: 'USD' }, { value: 'ARS', label: 'ARS' }]} />
          </Field>
        </div>
        <Field label="Fecha">
          <input type="date" value={form.date} onInput={(e) => set('date')(e.currentTarget.value)} required />
        </Field>
        <Field label="Nota (opcional)">
          <input value={form.note} onInput={(e) => set('note')(e.currentTarget.value)} maxLength={200} autocomplete="off" />
        </Field>
        <ErrorMessage>{error}</ErrorMessage>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" class="btn btn-primary" disabled={busy}>
            {form.type === 'deposit' ? 'Guardar depósito' : 'Guardar retiro'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
