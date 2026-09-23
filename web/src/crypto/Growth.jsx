import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtMoney, parseNumber, toInputValue } from '../format.js';
import { useApi, useMutation } from '../hooks.js';
import { ErrorMessage, Field, Loading, Modal } from '../components/ui.jsx';
import { GrowthView } from '../components/GrowthView.jsx';
import { GoalProgress } from './GoalProgress.jsx';

export function CryptoGrowth() {
  const holdings = useApi('/crypto/holdings');
  const growth = useApi('/crypto/growth');
  const [editingGoal, setEditingGoal] = useState(false);

  if (holdings.loading || growth.loading) return <Loading />;
  if (!holdings.data || !growth.data) return <ErrorMessage>{holdings.error ?? growth.error}</ErrorMessage>;

  const { total, goal } = holdings.data;

  return (
    <>
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Objetivo</h2>
          {goal && (
            <button type="button" class="btn btn-secondary" onClick={() => setEditingGoal(true)}>
              Cambiar
            </button>
          )}
        </div>
        {goal ? (
          <GoalProgress total={total} goal={goal} />
        ) : (
          <div class="empty">
            <p class="muted">Poné un monto objetivo en USDT para ver cuánto te falta.</p>
            <button type="button" class="btn btn-primary" onClick={() => setEditingGoal(true)}>
              Definir objetivo
            </button>
          </div>
        )}
      </section>

      <GrowthView data={growth.data.currencies[0] ?? null} goal={goal} />

      {editingGoal && <GoalModal goal={goal} onClose={() => setEditingGoal(false)} />}
    </>
  );
}

function GoalModal({ goal, onClose }) {
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
