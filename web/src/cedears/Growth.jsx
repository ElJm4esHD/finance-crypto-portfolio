import { useApi } from '../hooks.js';
import { ErrorMessage, Loading } from '../components/ui.jsx';
import { GrowthView } from '../components/GrowthView.jsx';

export function CedearGrowth() {
  const { data, error, loading } = useApi('/cedears/growth');
  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;
  return (
    <>
      <GrowthView growth={data} />
      <p class="muted small footnote">Valor total en USD: posiciones a precio de mercado más el dinero disponible.</p>
    </>
  );
}
