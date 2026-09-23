import { UserError } from './errors.js';
import { clean } from './num.js';

export function toNumber(value, label, { min = 0, allowMin = false } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new UserError(`${label}: ingresá un número válido.`);
  }
  if (allowMin ? n < min : n <= min) {
    throw new UserError(`${label} tiene que ser mayor ${allowMin ? 'o igual ' : ''}a ${min}.`);
  }
  return clean(n);
}

export function toTicker(value, label) {
  const t = String(value ?? '').trim().toUpperCase();
  if (!t) throw new UserError(`Falta ${label}.`);
  if (t.length > 20) throw new UserError(`${label} es demasiado largo (máximo 20 caracteres).`);
  return t;
}

export function toDate(value, label = 'La fecha') {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new UserError(`${label} no es válida.`);
  }
  return s;
}

// Local date-time as typed by the user ("YYYY-MM-DDTHH:mm"); stored as-is.
export function toDateTime(value, label = 'La fecha') {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new UserError(`${label} no es válida.`);
  }
  return s.slice(0, 16);
}

export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new UserError(`${label} no es válido.`);
  return value;
}
