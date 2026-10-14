import { Icon } from './ui.jsx';

// Time ranges shared by the growth chart and the price chart of each asset.
export const RANGES = [
  { id: '1D', label: '1 día' },
  { id: '5D', label: '5 días' },
  { id: '1M', label: '1 mes' },
  { id: '6M', label: '6 meses' },
  { id: 'YTD', label: 'en el año' },
  { id: '1A', label: '1 año' },
  { id: 'Todo', label: 'total' },
  { id: 'custom', short: 'Personalizado', label: 'en el período' },
];

export const rangeById = (id) => RANGES.find((r) => r.id === id) ?? RANGES[0];

// Segmented pill of ranges (the selected one highlighted). "Personalizado"
// shows from/to dates; on the phone it is a calendar icon.
// custom: { from, to } (YYYY-MM-DD) · min/max: limits for the dates.
export function RangePicker({ value, onChange, custom, onCustom, min, max }) {
  return (
    <div class="range-picker">
      <div class="ranges" role="radiogroup" aria-label="Período">
        {RANGES.map((r) => (
          <button
            type="button"
            role="radio"
            aria-checked={r.id === value}
            aria-label={r.short}
            title={r.short}
            class={`${r.id === value ? 'active' : ''} ${r.short ? 'range-custom' : ''}`}
            onClick={() => onChange(r.id)}
          >
            {r.short ? (
              <>
                <span class="range-text">{r.short}</span>
                <Icon name="calendar" />
              </>
            ) : (
              r.id
            )}
          </button>
        ))}
      </div>
      {value === 'custom' && (
        <div class="custom-range">
          <label>
            <span>Desde</span>
            <input type="date" value={custom.from} min={min} max={custom.to || max} onInput={(e) => onCustom({ ...custom, from: e.currentTarget.value })} />
          </label>
          <label>
            <span>Hasta</span>
            <input type="date" value={custom.to} min={custom.from || min} max={max} onInput={(e) => onCustom({ ...custom, to: e.currentTarget.value })} />
          </label>
        </div>
      )}
    </div>
  );
}
