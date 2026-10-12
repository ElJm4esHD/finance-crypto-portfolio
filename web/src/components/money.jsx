import { fmtMoney, fmtStamp } from '../format.js';
import { Icon, StaleBadge } from './ui.jsx';

// ARS ↔ USD with the dólar MEP of the day (rate = pesos per dollar).
// USDT counts as USD, 1:1.
const base = (c) => (c === 'USDT' ? 'USD' : c);

export function convert(amount, from, to, rate) {
  if (amount == null) return null;
  if (base(from) === base(to)) return amount;
  if (!rate) return null;
  return base(from) === 'USD' ? amount * rate : amount / rate;
}

// Small dropdown to pick the currency every amount is shown in.
export function CurrencySelect({ value, onChange, disabled = false }) {
  return (
    <label class="currency-select" title={disabled ? 'Sin cotización del dólar MEP no se puede convertir' : 'Moneda de los montos'}>
      <span class="sr-only">Mostrar montos en</span>
      <select value={value} onChange={(e) => onChange(e.currentTarget.value)} disabled={disabled}>
        <option value="ARS">ARS</option>
        <option value="USD">USD</option>
      </select>
      <Icon name="chevron" />
    </label>
  );
}

// "Dólar MEP: $ 1.542,90 · actualizado 17:59", shown next to converted amounts.
export function MepNote({ fx }) {
  if (!fx) {
    return <p class="fx-note">Todavía no hay cotización del dólar MEP: los montos no se convierten.</p>;
  }
  return (
    <p class="fx-note">
      <span>
        Dólar MEP {fmtMoney(fx.rate, 'ARS')} · actualizado {fmtStamp(fx.updatedAt)}
        {fx.mock && ' · simulado'}
      </span>
      {fx.stale && <StaleBadge since={fx.stale.since} title={`${fx.name} no responde: se usa la última cotización guardada.`} />}
    </p>
  );
}
