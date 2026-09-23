import { fmtMoney, fmtPct } from '../format.js';

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
