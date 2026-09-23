import { useState } from 'preact/hooks';
import { useApi } from '../hooks.js';
import { ErrorMessage, Loading, Segmented } from '../components/ui.jsx';
import { GrowthView } from '../components/GrowthView.jsx';

const ORDER = ['ARS', 'USD'];

export function CedearGrowth() {
  const { data, error, loading } = useApi('/cedears/growth');
  const [currency, setCurrency] = useState(null);
  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  const currencies = [...data.currencies].sort((a, b) => ORDER.indexOf(a.currency) - ORDER.indexOf(b.currency));
  const current = currencies.find((c) => c.currency === currency) ?? currencies[0] ?? null;

  return (
    <>
      <GrowthView
        data={current}
        titleExtra={
          currencies.length > 1 && (
            <Segmented
              label="Moneda"
              value={current.currency}
              onChange={setCurrency}
              options={currencies.map((c) => ({ value: c.currency, label: c.currency }))}
            />
          )
        }
      />
      <p class="muted small footnote">Valor de cada moneda por separado: posiciones a precio de mercado más el dinero disponible.</p>
    </>
  );
}
