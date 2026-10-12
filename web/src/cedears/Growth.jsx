import { useApi, useStoredState } from '../hooks.js';
import { ErrorMessage, Loading } from '../components/ui.jsx';
import { CurrencySelect, MepNote } from '../components/money.jsx';
import { GrowthPanel } from '../components/GrowthPanel.jsx';
import { CEDEAR_CURRENCY_KEY } from './Portfolio.jsx';

// Phone only: the growth chart has its own tab there (on desktop it lives in
// Cartera). Both currencies added up in the one picked, as in Cartera.
export function CedearGrowth() {
  const { data, error, loading } = useApi('/fx/mep');
  const [picked, setPicked] = useStoredState(CEDEAR_CURRENCY_KEY, 'ARS');
  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;
  const currency = picked === 'USD' ? 'USD' : 'ARS';

  return (
    <section class="card">
      <div class="card-head">
        <h2 class="card-title">Crecimiento</h2>
        <CurrencySelect value={currency} onChange={setPicked} disabled={!data.mep} />
      </div>
      <GrowthPanel section="cedears" currency={currency} />
      <MepNote fx={data.mep} />
    </section>
  );
}
