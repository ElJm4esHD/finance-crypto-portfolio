import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, nowLocalIso, parseNumber } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { ErrorMessage, Field, Icon, Modal, Segmented } from '../components/ui.jsx';

const KINDS = [
  { value: 'exchange', label: 'Intercambio' },
  { value: 'deposit', label: 'Aporte', tone: 'flag' },
  { value: 'withdrawal', label: 'Retiro', tone: 'flag' },
];

// Everything that moves the crypto balances: exchanges between coins, and
// money put in (aporte) or taken out (retiro), which is what counts as
// invested.
export function ExchangeModal({ onClose }) {
  const [kind, setKind] = useState('exchange');
  return (
    <Modal title={kind === 'exchange' ? 'Nuevo intercambio' : kind === 'deposit' ? 'Nuevo aporte' : 'Nuevo retiro'} onClose={onClose}>
      <div class="form">
        <Segmented label="Tipo" size="lg" value={kind} onChange={setKind} options={KINDS} />
        {kind === 'exchange' ? <ExchangeForm onClose={onClose} /> : <FlowForm type={kind} onClose={onClose} />}
      </div>
    </Modal>
  );
}

function ExchangeForm({ onClose }) {
  const { data } = useApi('/crypto/holdings');
  const [form, setForm] = useState({
    executedAt: nowLocalIso(),
    fromAsset: '',
    fromAmount: '',
    toAsset: '',
    toAmount: '',
    feeAsset: '',
    feeAmount: '',
  });
  const { run, busy, error, setError } = useMutation();

  const set = (key, upper = false) => (e) => {
    const value = upper ? e.currentTarget.value.toUpperCase() : e.currentTarget.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const balances = Object.fromEntries((data?.holdings ?? []).map((h) => [h.asset, h.amount]));
  const available = form.fromAsset ? balances[form.fromAsset.trim()] : undefined;

  async function submit(e) {
    e.preventDefault();
    const nums = {
      fromAmount: parseNumber(form.fromAmount),
      toAmount: parseNumber(form.toAmount),
      feeAmount: parseNumber(form.feeAmount),
    };
    if ([nums.fromAmount, nums.toAmount].some((n) => n === null || Number.isNaN(n))) {
      return setError('Revisá las cantidades: tienen que ser números.');
    }
    if (Number.isNaN(nums.feeAmount)) return setError('La comisión tiene que ser un número.');
    const { ok } = await run(() => api.post('/crypto/exchanges', { ...form, ...nums }));
    if (ok) onClose();
  }

  return (
    <form onSubmit={submit} class="form">
      <datalist id="crypto-assets">
        {Object.keys(balances).map((a) => (
          <option value={a} />
        ))}
      </datalist>

      <fieldset class="pair">
        <legend>Entregás</legend>
        <div class="pair-row">
          <input aria-label="Cantidad que entregás" value={form.fromAmount} onInput={set('fromAmount')} inputMode="decimal" placeholder="0,00" autocomplete="off" required autofocus />
          <input aria-label="Moneda que entregás" value={form.fromAsset} onInput={set('fromAsset', true)} list="crypto-assets" placeholder="USDT" class="asset-input" autocomplete="off" required maxLength={20} />
        </div>
        {available !== undefined && (
          <span class="field-hint">
            Tenés {fmtAmount(available)} {form.fromAsset.trim()}
          </span>
        )}
      </fieldset>

      <div class="pair-arrow" aria-hidden="true">
        <Icon name="arrow" />
      </div>

      <fieldset class="pair">
        <legend>Recibís</legend>
        <div class="pair-row">
          <input aria-label="Cantidad que recibís" value={form.toAmount} onInput={set('toAmount')} inputMode="decimal" placeholder="0,00" autocomplete="off" required />
          <input aria-label="Moneda que recibís" value={form.toAsset} onInput={set('toAsset', true)} list="crypto-assets" placeholder="BTC" class="asset-input" autocomplete="off" required maxLength={20} />
        </div>
      </fieldset>

      <fieldset class="pair">
        <legend>
          Comisión <span class="muted">(opcional)</span>
        </legend>
        <div class="pair-row">
          <input aria-label="Cantidad de comisión" value={form.feeAmount} onInput={set('feeAmount')} inputMode="decimal" placeholder="0" autocomplete="off" />
          <input aria-label="Moneda de la comisión" value={form.feeAsset} onInput={set('feeAsset', true)} list="crypto-assets" placeholder="Moneda" class="asset-input" autocomplete="off" maxLength={20} required={parseNumber(form.feeAmount) > 0} />
        </div>
      </fieldset>

      <Field label="Fecha y hora">
        <input type="datetime-local" value={form.executedAt} onInput={set('executedAt')} required />
      </Field>

      <ErrorMessage>{error}</ErrorMessage>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" class="btn btn-primary" disabled={busy}>
          Guardar intercambio
        </button>
      </div>
    </form>
  );
}

function FlowForm({ type, onClose }) {
  const { data } = useApi('/crypto/holdings');
  const [form, setForm] = useState({ asset: '', amount: '', valueUsdt: '', executedAt: nowLocalIso() });
  const { run, busy, error, setError } = useMutation();
  const set = (key, upper = false) => (e) => {
    const value = upper ? e.currentTarget.value.toUpperCase() : e.currentTarget.value;
    setForm((f) => ({ ...f, [key]: value }));
  };
  const balances = Object.fromEntries((data?.holdings ?? []).map((h) => [h.asset, h.amount]));
  const held = balances[form.asset.trim()];

  async function submit(e) {
    e.preventDefault();
    const amount = parseNumber(form.amount);
    const valueUsdt = parseNumber(form.valueUsdt);
    if (amount === null || Number.isNaN(amount) || amount <= 0) return setError('Ingresá una cantidad mayor a 0.');
    if (Number.isNaN(valueUsdt)) return setError('El valor en USDT tiene que ser un número.');
    const { ok } = await run(() => api.post('/crypto/flows', { ...form, type, amount, valueUsdt }));
    if (ok) onClose();
  }

  return (
    <form onSubmit={submit} class="form">
      <p class="form-note">
        {type === 'deposit'
          ? 'Plata nueva que entra (por ejemplo, USDT comprados con pesos): se suma al saldo y a lo invertido, no al rendimiento.'
          : 'Plata que sacás: se resta del saldo y de lo invertido, no del rendimiento.'}
      </p>
      <datalist id="crypto-flow-assets">
        {Object.keys(balances).map((a) => (
          <option value={a} />
        ))}
      </datalist>
      <fieldset class="pair">
        <legend>{type === 'deposit' ? 'Ingresa' : 'Sale'}</legend>
        <div class="pair-row">
          <input aria-label="Cantidad" value={form.amount} onInput={set('amount')} inputMode="decimal" placeholder="0,00" autocomplete="off" required autofocus />
          <input aria-label="Moneda" value={form.asset} onInput={set('asset', true)} list="crypto-flow-assets" placeholder="USDT" class="asset-input" autocomplete="off" required maxLength={20} />
        </div>
        {type === 'withdrawal' && held !== undefined && (
          <span class="field-hint">
            Tenés {fmtAmount(held)} {form.asset.trim()}
          </span>
        )}
      </fieldset>
      <Field label="Valor en USDT (opcional)" hint="Lo que pagaste o cobraste. Vacío: se usa el precio de mercado de ahora.">
        <input value={form.valueUsdt} onInput={set('valueUsdt')} inputMode="decimal" placeholder="A precio de mercado" autocomplete="off" />
      </Field>
      <Field label="Fecha y hora">
        <input type="datetime-local" value={form.executedAt} onInput={set('executedAt')} required />
      </Field>
      <ErrorMessage>{error}</ErrorMessage>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" class="btn btn-primary" disabled={busy}>
          {type === 'deposit' ? 'Guardar aporte' : 'Guardar retiro'}
        </button>
      </div>
    </form>
  );
}
