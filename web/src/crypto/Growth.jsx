import { useState } from 'preact/hooks';
import { useApi, useStoredState } from '../hooks.js';
import { ErrorMessage, Loading } from '../components/ui.jsx';
import { CurrencySelect } from '../components/money.jsx';
import { GrowthPanel } from '../components/GrowthPanel.jsx';
import { GoalModal, GoalProgress } from './GoalProgress.jsx';
import { CRYPTO_CURRENCY_KEY } from './Holdings.jsx';

// Phone only: the growth chart has its own tab there (on desktop it lives in
// Cartera). Same currency as Cartera.
export function CryptoGrowth() {
  const { data, error, loading } = useApi('/crypto/holdings');
  const [picked, setPicked] = useStoredState(CRYPTO_CURRENCY_KEY, 'USD');
  const [editingGoal, setEditingGoal] = useState(false);

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  const rate = data.fx?.rate ?? null;
  const currency = rate && picked === 'ARS' ? 'ARS' : 'USD';

  return (
    <>
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Crecimiento</h2>
          <CurrencySelect value={currency} onChange={setPicked} disabled={!rate} />
        </div>
        <GrowthPanel section="crypto" currency={currency} />
      </section>

      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Objetivo</h2>
          {data.goal && (
            <button type="button" class="btn btn-secondary btn-sm" onClick={() => setEditingGoal(true)}>
              Cambiar
            </button>
          )}
        </div>
        {data.goal ? (
          <GoalProgress total={data.total} goal={data.goal} />
        ) : (
          <div class="empty">
            <p class="muted">Poné un monto objetivo en USDT para ver cuánto te falta.</p>
            <button type="button" class="btn btn-primary" onClick={() => setEditingGoal(true)}>
              Definir objetivo
            </button>
          </div>
        )}
      </section>

      {editingGoal && <GoalModal goal={data.goal} onClose={() => setEditingGoal(false)} />}
    </>
  );
}
