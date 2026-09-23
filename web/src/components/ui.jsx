import { useEffect, useRef } from 'preact/hooks';
import { fmtPct, fmtSignedMoney, fmtStamp } from '../format.js';

export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.open && dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      class="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div class="modal-body">
        <header class="modal-header">
          <h2>{title}</h2>
          <button type="button" class="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label class="field">
      <span class="field-label">{label}</span>
      {children}
      {hint && <span class="field-hint">{hint}</span>}
    </label>
  );
}

// Segmented control for 2–4 exclusive options.
export function Segmented({ value, options, onChange, label, size }) {
  return (
    <div class={`segmented ${size === 'lg' ? 'segmented-lg' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === o.value}
          class={`${value === o.value ? 'active' : ''} ${o.tone ? `tone-${o.tone}` : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorMessage({ children }) {
  if (!children) return null;
  return (
    <p class="error-msg" role="alert">
      <Icon name="alert" /> <span>{children}</span>
    </p>
  );
}

// Small badge next to a figure that could not be refreshed: the API did not
// answer and the last valid value is shown. `since` is when it was obtained.
export function StaleBadge({ since, title }) {
  return (
    <span class="pill" title={title ?? 'No se pudo actualizar: se muestra el último valor guardado.'}>
      Precio desactualizado desde {fmtStamp(since)}
    </span>
  );
}

// Badge about where the prices come from: simulated, outdated or missing.
export function PriceNotice({ source }) {
  if (!source) return null;
  if (source.stale) {
    return (
      <StaleBadge
        since={source.stale.since}
        title={`${source.name} no responde (${source.error}). Se muestran los últimos precios guardados.`}
      />
    );
  }
  if (source.error) {
    return (
      <span class="pill" title={`${source.name} no responde (${source.error}).`}>
        Sin precios de {source.name}
      </span>
    );
  }
  if (source.mock) {
    return (
      <span class="pill" title="Los precios son inventados para probar la app (proveedor de precios en modo simulado).">
        Precios simulados
      </span>
    );
  }
  return null;
}

// Day changes are small: two decimals, and the color follows what is shown.
const dayTone = (pct) => (pct >= 0.005 ? 'up' : pct <= -0.005 ? 'down' : '');

// "Hoy +1,24 % (+140,00 USDT)" — change since the previous close. Hidden without data.
export function DayChange({ change, pct, currency }) {
  if (pct == null) return null;
  return (
    <p class="day-change">
      <span class="muted">Hoy</span>{' '}
      <span class={`change-value ${dayTone(pct)}`}>
        {fmtPct(pct, { signed: true, digits: 2 })} ({fmtSignedMoney(change, currency)})
      </span>
    </p>
  );
}

// Day change of one position, for table cells ("+2,41 %").
export function PctChange({ value }) {
  if (value == null) return '—';
  return <span class={`change-value ${dayTone(value)}`}>{fmtPct(value, { signed: true, digits: 2 })}</span>;
}

export function EmptyState({ title, children, action }) {
  return (
    <div class="empty">
      <p class="empty-title">{title}</p>
      {children && <p class="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Loading() {
  return <p class="muted loading">Cargando…</p>;
}

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  wallet: 'M4 7h14a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V7zM4 7l11-3v3M16 13.5h.01',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  chart: 'M4 17l5-5 4 4 7-7M15 9h5v5',
};

export function Icon({ name }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}
