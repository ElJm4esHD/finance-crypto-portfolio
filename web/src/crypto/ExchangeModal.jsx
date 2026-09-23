import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, nowLocalIso, parseNumber } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { ErrorMessage, Field, Icon, Modal } from '../components/ui.jsx';

export function ExchangeModal({ onClose }) {
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
    <Modal title="Nuevo intercambio" onClose={onClose}>
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
    </Modal>
  );
}
