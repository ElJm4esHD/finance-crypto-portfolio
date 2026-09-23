const LOCALE = 'es-AR';

const nf = (min, max) => new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max });
const money2 = nf(2, 2);
const amount8 = nf(0, 8);
const pct1 = nf(1, 1);

const PREFIX = { USD: 'US$ ', ARS: '$ ' };

// "US$ 1.234,56" · "$ 1.234,56" · "1.234,56 USDT"
export function fmtMoney(n, currency) {
  if (n == null) return '—';
  const s = money2.format(n);
  return PREFIX[currency] ? `${PREFIX[currency]}${s}` : `${s} ${currency}`;
}

// Prices can be tiny (SHIB) or large (BTC): keep 2 decimals unless more are needed.
export function fmtPrice(n, currency) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1 || n === 0) return fmtMoney(n, currency);
  const s = nf(2, 8).format(Number(n.toPrecision(4)));
  return PREFIX[currency] ? `${PREFIX[currency]}${s}` : `${s} ${currency}`;
}

// Quantities: as many decimals as they have (up to 8), no trailing zeros.
export const fmtAmount = (n) => (n == null ? '—' : amount8.format(n));

export function fmtPct(n, { signed = false, digits = 1 } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const half = 0.5 / 10 ** digits; // below this it rounds to zero: show it unsigned
  const s = (digits === 1 ? pct1 : nf(digits, digits)).format(Math.abs(n) < half ? 0 : n);
  return `${signed && n >= half ? '+' : ''}${s} %`;
}

export function fmtSignedMoney(n, currency) {
  if (n == null) return '—';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtMoney(Math.abs(n), currency)}`;
}

// Compact axis labels: 950 · 12,5 mil · 1,2 M
export function fmtCompact(n) {
  return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// "2026-09-23" → "23/09/2026"
export function fmtDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// "2026-09-23T14:05" → "23/09/2026 14:05"
export const fmtDateTime = (iso) => `${fmtDate(iso)} ${iso.slice(11, 16)}`;

// Short chart labels by view: "23 sep" · "sep 2026" · "2026"
export function fmtChartDate(iso, view) {
  const [y, m, d] = iso.split('-');
  if (view === 'yearly') return y;
  if (view === 'monthly') return `${MONTHS[Number(m) - 1]} ${y}`;
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

export function fmtLongDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// Accepts "1234.5", "1234,5" and "0,00012". No thousands separators: the last
// "," or "." is the decimal point.
export function parseNumber(input) {
  const s = String(input ?? '').trim().replace(/\s/g, '');
  if (s === '') return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const normalized = lastSep === -1 ? s : s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1);
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

const pad = (n) => String(n).padStart(2, '0');

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowLocalIso() {
  const d = new Date();
  return `${todayIso()}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Prefill value for editable number inputs: "0,00000012", no grouping, no exponent.
export const toInputValue = (n) =>
  n == null ? '' : n.toLocaleString(LOCALE, { useGrouping: false, maximumFractionDigits: 12 });
