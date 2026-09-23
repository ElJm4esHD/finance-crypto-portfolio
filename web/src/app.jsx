import { useMemo, useState } from 'preact/hooks';
import { DataVersion, useHashRoute } from './hooks.js';
import { Icon } from './components/ui.jsx';
import { CryptoHoldings } from './crypto/Holdings.jsx';
import { CryptoExchanges } from './crypto/Exchanges.jsx';
import { CryptoGrowth } from './crypto/Growth.jsx';
import { ExchangeModal } from './crypto/ExchangeModal.jsx';
import { CedearPortfolio } from './cedears/Portfolio.jsx';
import { CedearHistory } from './cedears/History.jsx';
import { CedearGrowth } from './cedears/Growth.jsx';
import { OperationModal } from './cedears/OperationModal.jsx';

const SECTIONS = {
  cripto: {
    label: 'Cripto',
    action: 'Nuevo intercambio',
    exportUrl: '/api/crypto/export.csv',
    Modal: ExchangeModal,
    tabs: [
      { id: 'cartera', label: 'Cartera', View: CryptoHoldings },
      { id: 'historial', label: 'Historial', View: CryptoExchanges },
      { id: 'crecimiento', label: 'Crecimiento', View: CryptoGrowth },
    ],
  },
  cedears: {
    label: 'CEDEARs / ETF',
    action: 'Nueva operación',
    exportUrl: '/api/cedears/export.csv',
    Modal: OperationModal,
    tabs: [
      { id: 'cartera', label: 'Cartera', View: CedearPortfolio },
      { id: 'historial', label: 'Historial', View: CedearHistory },
      { id: 'crecimiento', label: 'Crecimiento', View: CedearGrowth },
    ],
  },
};

export function App() {
  const [version, setVersion] = useState(0);
  const dataCtx = useMemo(() => ({ version, bump: () => setVersion((v) => v + 1) }), [version]);
  const [sectionId, tabId] = useHashRoute();
  const [modalOpen, setModalOpen] = useState(false);

  const sid = SECTIONS[sectionId] ? sectionId : 'cripto';
  const section = SECTIONS[sid];
  const tab = section.tabs.find((t) => t.id === tabId) ?? section.tabs[0];
  const { View } = tab;
  const openModal = () => setModalOpen(true);

  return (
    <DataVersion.Provider value={dataCtx}>
      <header class="topbar">
        <div class="container topbar-inner">
          <span class="brand">Mi cartera</span>
          <nav class="section-switch" aria-label="Sección">
            {Object.entries(SECTIONS).map(([id, s]) => (
              <a href={`#/${id}`} class={id === sid ? 'active' : ''} aria-current={id === sid ? 'page' : undefined}>
                {s.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <div class="subbar">
        <div class="container subbar-inner">
          <nav class="tabs" aria-label={section.label}>
            {section.tabs.map((t) => (
              <a href={`#/${sid}/${t.id}`} class={t.id === tab.id ? 'active' : ''} aria-current={t.id === tab.id ? 'page' : undefined}>
                {t.label}
              </a>
            ))}
          </nav>
          <div class="subbar-actions">
            {/* Cartera + historial of this section in one CSV file. */}
            <a class="btn btn-secondary" href={section.exportUrl} download title="Exportar cartera e historial a CSV">
              <Icon name="download" /> <span>Exportar</span>
            </a>
            <button type="button" class="btn btn-primary" onClick={openModal}>
              <Icon name="plus" /> <span>{section.action}</span>
            </button>
          </div>
        </div>
      </div>

      <main class="container main" key={`${sid}/${tab.id}`}>
        <View onNew={openModal} onNewOperation={openModal} />
      </main>

      {modalOpen && <section.Modal onClose={() => setModalOpen(false)} />}
    </DataVersion.Provider>
  );
}
