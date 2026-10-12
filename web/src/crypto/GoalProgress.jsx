import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtMoney, fmtPct, parseNumber, toInputValue } from '../format.js';
import { useMutation } from '../hooks.js';
import { ErrorMessage, Field, Modal } from '../components/ui.jsx';

// Progress toward the USDT goal. `compact` is the one-line version for the Holdings hero.
export function GoalProgress({ total, goal, compact = false }) {
  const pct = (total / goal) * 100;
  const reached = total >= goal;
  const remaining = goal - total;

  if (compact) {
    return (
      <div class="goal-compact">
        <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(pct, 100)}>
          <div class="meter-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span class="muted">
          {reached ? 'Objetivo alcanzado' : `${fmtPct(pct)} del objetivo de ${fmtMoney(goal, 'USDT')}`}
        </span>
      </div>
    );
  }

  return (
    <div class="goal">
      <p class="goal-pct">{fmtPct(pct)}</p>
      <div class="meter meter-lg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(pct, 100)}>
        <div class="meter-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <p class="goal-text">
        {reached ? (
          <>
            <strong>¡Objetivo alcanzado!</strong> Estás {fmtMoney(-remaining, 'USDT')} por encima.
          </>
        ) : (
          <>
            Faltan <strong>{fmtMoney(remaining, 'USDT')}</strong> para llegar a {fmtMoney(goal, 'USDT')}.
          </>
        )}
      </p>
    </div>
  );
}

export function GoalModal({ goal, onClose }) {
  const [value, setValue] = useState(goal ? toInputValue(goal) : '');
  const { run, busy, error, setError } = useMutation();

  async function save(e) {
    e.preventDefault();
    const n = parseNumber(value);
    if (n === null || Number.isNaN(n) || n <= 0) return setError('Ingresá un monto mayor a 0.');
    const { ok } = await run(() => api.put('/crypto/goal', { amount: n }));
    if (ok) onClose();
  }

  async function clear() {
    const { ok } = await run(() => api.put('/crypto/goal', { amount: null }));
    if (ok) onClose();
  }

  return (
    <Modal title="Objetivo de la cartera" onClose={onClose}>
      <form onSubmit={save} class="form">
        <Field label="Monto objetivo en USDT" hint={goal ? `Actual: ${fmtMoney(goal, 'USDT')}` : undefined}>
          <input value={value} onInput={(e) => setValue(e.currentTarget.value)} inputMode="decimal" placeholder="10000" autocomplete="off" autofocus required />
        </Field>
        <ErrorMessage>{error}</ErrorMessage>
        <div class="form-actions">
          {goal && (
            <button type="button" class="btn btn-danger-text" onClick={clear} disabled={busy}>
              Quitar objetivo
            </button>
          )}
          <button type="submit" class="btn btn-primary" disabled={busy}>
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}
