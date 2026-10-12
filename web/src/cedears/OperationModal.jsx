import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, fmtMoney, parseNumber, todayIso } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { ErrorMessage, Field, Modal, Segmented } from '../components/ui.jsx';

const KINDS = [
  { value: 'buy', label: 'Compra', tone: 'up' },
  { value: 'sell', label: 'Venta', tone: 'down' },
  { value: 'deposit', label: 'Depósito', tone: 'flag' },
  { value: 'withdrawal', label: 'Retiro', tone: 'flag' },
];

const CurrencyField = ({ value, onChange }) => (
  <Field label="Moneda">
    <Segmented label="Moneda" value={value} onChange={onChange} options={[{ value: 'USD', label: 'USD' }, { value: 'ARS', label: 'ARS' }]} />
  </Field>
);

// One entry point for everything that moves the CEDEARs/ETF portfolio:
// buys and sells, and the money deposited or withdrawn (which is what counts
// as invested).
export function OperationModal({ onClose }) {
  const [kind, setKind] = useState('buy');
  const isTrade = kind === 'buy' || kind === 'sell';
  return (
    <Modal title={isTrade ? 'Nueva operación' : 'Movimiento de dinero'} onClose={onClose}>
      <div class="form">
        <Segmented label="Tipo" size="lg" value={kind} onChange={setKind} options={KINDS} />
        {isTrade ? <TradeForm type={kind} onClose={onClose} /> : <CashForm type={kind} onClose={onClose} />}
      </div>
    </Modal>
  );
}

function TradeForm({ type, onClose }) {
  const { data: portfolio } = useApi('/cedears/portfolio');
  const [form, setForm] = useState({ ticker: '', quantity: '', price: '', currency: 'USD', commission: '', date: todayIso() });
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
  const total = gross === null ? null : type === 'buy' ? gross + commission : gross - commission;
  const available = portfolio?.cash[form.currency];
  const held = positions.find((p) => p.ticker === ticker && p.currency === form.currency)?.quantity ?? 0;

  async function submit(e) {
    e.preventDefault();
    if (!valid) return setError('Revisá cantidad, precio y comisión: tienen que ser números.');
    const { ok } = await run(() => api.post('/cedears/operations', { ...form, type, quantity, price, commission }));
    if (ok) onClose();
  }

  return (
    <form onSubmit={submit} class="form">
      <datalist id="cedear-tickers">
        {[...new Set(positions.map((p) => p.ticker))].map((t) => (
          <option value={t} />
        ))}
      </datalist>

      <div class="form-row">
        <Field label="Ticker" hint={type === 'sell' && ticker ? `Tenés ${fmtAmount(held)} en ${form.currency}` : undefined}>
          <input value={form.ticker} onInput={(e) => onTicker(e.currentTarget.value)} list="cedear-tickers" placeholder="AAPL.BA" autocomplete="off" required autofocus maxLength={20} />
        </Field>
        <CurrencyField value={form.currency} onChange={set('currency')} />
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
          <span class="muted">{type === 'buy' ? 'Total a pagar' : 'Total a cobrar'}</span>
          <strong>{total === null ? '—' : fmtMoney(total, form.currency)}</strong>
        </div>
        <div>
          <span class="muted">Disponible en {form.currency}</span>
          <strong class={type === 'buy' && total !== null && available !== undefined && total > available + 1e-9 ? 'text-down' : ''}>
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
          {type === 'buy' ? 'Guardar compra' : 'Guardar venta'}
        </button>
      </div>
    </form>
  );
}

function CashForm({ type, onClose }) {
  const [form, setForm] = useState({ currency: 'USD', amount: '', date: todayIso(), note: '' });
  const { run, busy, error, setError } = useMutation();
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    const amount = parseNumber(form.amount);
    if (amount === null || Number.isNaN(amount) || amount <= 0) return setError('Ingresá un monto mayor a 0.');
    const { ok } = await run(() => api.post('/cedears/cash-movements', { ...form, type, amount }));
    if (ok) onClose();
  }

  return (
    <form onSubmit={submit} class="form">
      <p class="form-note">
        {type === 'deposit'
          ? 'Plata nueva que entra a la cartera: suma a lo invertido, no al rendimiento.'
          : 'Plata que sacás de la cartera: resta de lo invertido, no del rendimiento.'}
      </p>
      <div class="form-row">
        <Field label="Monto">
          <input value={form.amount} onInput={(e) => set('amount')(e.currentTarget.value)} inputMode="decimal" placeholder="0,00" autocomplete="off" required autofocus />
        </Field>
        <CurrencyField value={form.currency} onChange={set('currency')} />
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
          {type === 'deposit' ? 'Guardar depósito' : 'Guardar retiro'}
        </button>
      </div>
    </form>
  );
}
