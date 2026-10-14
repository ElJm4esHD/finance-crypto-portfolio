import { UserError } from '../lib/errors.js';
import { toDate } from '../lib/validate.js';

// Time ranges of the price chart of one asset (same as the growth chart).
export const PRICE_RANGES = ['1D', '5D', '1M', '6M', 'YTD', '1A', 'Todo', 'custom'];

const DAY = 86400_000;
const BACK = { '1D': 1, '5D': 5, '1M': 30, '6M': 182, '1A': 365 };

// Window of a range in ms: { start, end }. start null = all the history.
// custom uses `from`/`to` dates (YYYY-MM-DD, inclusive).
export function rangeWindow(range, { from, to } = {}, now = Date.now()) {
  if (BACK[range]) return { start: now - BACK[range] * DAY, end: now };
  if (range === 'YTD') return { start: Date.UTC(new Date(now).getUTCFullYear(), 0, 1), end: now };
  if (range === 'Todo') return { start: null, end: now };
  return { start: Date.parse(`${from}T00:00:00Z`), end: Math.min(Date.parse(`${to}T23:59:59Z`), now) };
}

// ?range=…&from=…&to=… → { range, dates }. Default: 1D.
export function parseRange(query = {}) {
  const range = query.range ?? '1D';
  if (!PRICE_RANGES.includes(range)) throw new UserError('El rango no es válido.');
  if (range !== 'custom') return { range, dates: {} };
  const from = toDate(query.from, 'La fecha desde');
  const to = toDate(query.to, 'La fecha hasta');
  if (from > to) throw new UserError('La fecha desde tiene que ser anterior a la fecha hasta.');
  return { range, dates: { from, to } };
}

export const spanDays = ({ start, end }) => (start === null ? Infinity : (end - start) / DAY);
