import { fmtMoney, fmtStamp } from '../format.js';
import { Segmented, StaleBadge } from './ui.jsx';

// ARS ↔ USD with the dólar MEP of the day (rate = pesos per dollar).
// USDT counts as USD, 1:1.
const base = (c) => (c === 'USDT' ? 'USD' : c);
const otherOf = (c) => (base(c) === 'ARS' ? 'USD' : 'ARS');

export function convert(amount, from, to, rate) {
  if (amount == null) return null;
  if (base(from) === base(to)) return amount;
  if (!rate) return null;
  return base(from) === 'USD' ? amount * rate : amount / rate;
}

// Currency picker shared by both sections: ARS, USD or both.
export function DisplayCurrency({ value, onChange }) {
  return (
    <Segmented
      label="Mostrar montos en"
      value={value}
      onChange={onChange}
      options={[
        { value: 'ARS', label: 'ARS' },
        { value: 'USD', label: 'USD' },
        { value: 'both', label: 'Ambos' },
      ]}
    />
  );
}

// Currency to use for one figure: the selected one, or its own for "both"
// (and when there is no rate to convert).
export const shownCurrency = (display, currency, rate) => (display === 'both' || !rate ? base(currency) : display);

// An amount in the selected display: its own currency, converted, or both
// (own currency first, the conversion below).
export function Money({ amount, currency, display, rate }) {
  if (amount == null) return '—';
  const other = otherOf(currency);
  const converted = convert(amount, currency, other, rate);
  if (display === base(currency) || converted === null) return fmtMoney(amount, currency);
  if (display === 'both') {
    return (
      <>
        {fmtMoney(amount, currency)}
        <span class="small block muted converted">{fmtMoney(converted, other)}</span>
      </>
    );
  }
  return fmtMoney(converted, other);
}

// "Dólar MEP: $ 1.542,90 (actualizado 17:59)", shown next to converted amounts.
export function MepNote({ fx }) {
  if (!fx) {
    return <p class="fx-note">Todavía no hay cotización del dólar MEP: los montos no se convierten.</p>;
  }
  return (
    <p class="fx-note">
      <span>
        Dólar MEP: {fmtMoney(fx.rate, 'ARS')} (actualizado {fmtStamp(fx.updatedAt)}){fx.mock && ' · simulado'}
      </span>
      {fx.stale && <StaleBadge since={fx.stale.since} title={`${fx.name} no responde: se usa la última cotización guardada.`} />}
    </p>
  );
}
