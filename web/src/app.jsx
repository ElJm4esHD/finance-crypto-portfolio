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
      { id: 'cartera', label: 'Cartera', icon: 'wallet', View: CryptoHoldings },
      { id: 'historial', label: 'Historial', icon: 'list', View: CryptoExchanges },
      { id: 'crecimiento', label: 'Crecimiento', icon: 'chart', View: CryptoGrowth },
    ],
  },
  cedears: {
    label: 'CEDEARs / ETF',
    action: 'Nueva operación',
    exportUrl: '/api/cedears/export.csv',
    Modal: OperationModal,
    tabs: [
      { id: 'cartera', label: 'Cartera', icon: 'wallet', View: CedearPortfolio },
      { id: 'historial', label: 'Historial', icon: 'list', View: CedearHistory },
      { id: 'crecimiento', label: 'Crecimiento', icon: 'chart', View: CedearGrowth },
    ],
  },
};

// A phone asking for the desktop site gets a ~980px layout viewport with tiny
// text; the physical screen stays narrow, so the mismatch gives it away.
const DESKTOP_MODE_ON_PHONE = Math.min(window.screen.width, window.screen.height) < 600 && window.innerWidth > 900;

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

  const tabLinks = (className) =>
    section.tabs.map((t) => (
      <a href={`#/${sid}/${t.id}`} class={`${className} ${t.id === tab.id ? 'active' : ''}`} aria-current={t.id === tab.id ? 'page' : undefined}>
        {className === 'bottom-tab' && <Icon name={t.icon} />}
        <span>{t.label}</span>
      </a>
    ));

  // Cartera + historial of this section in one CSV file.
  const exportLink = (className, withLabel) => (
    <a class={className} href={section.exportUrl} download title="Exportar cartera e historial a CSV" aria-label="Exportar a CSV">
      <Icon name="download" />
      {withLabel && <span>Exportar</span>}
    </a>
  );

  return (
    <DataVersion.Provider value={dataCtx}>
      {DESKTOP_MODE_ON_PHONE && (
        <p class="desktop-mode-notice">
          Chrome está mostrando la versión de escritorio. Tocá ⋮ y desmarcá <strong>Sitio de escritorio</strong>.
        </p>
      )}

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
          {exportLink('icon-btn phone-only', false)}
        </div>
      </header>

      {/* Desktop: tabs and actions under the header. */}
      <div class="subbar desktop-only">
        <div class="container subbar-inner">
          <nav class="tabs" aria-label={section.label}>
            {tabLinks('tab')}
          </nav>
          <div class="subbar-actions">
            {exportLink('btn btn-secondary', true)}
            <button type="button" class="btn btn-primary" onClick={openModal}>
              <Icon name="plus" /> <span>{section.action}</span>
            </button>
          </div>
        </div>
      </div>

      <main class="container main" key={`${sid}/${tab.id}`}>
        <View onNew={openModal} onNewOperation={openModal} />
      </main>

      {/* Phone: app-style bottom tab bar and floating action button. */}
      <button type="button" class="fab phone-only" onClick={openModal} aria-label={section.action}>
        <Icon name="plus" />
      </button>
      <nav class="bottom-nav phone-only" aria-label={section.label}>
        {tabLinks('bottom-tab')}
      </nav>

      {modalOpen && <section.Modal onClose={() => setModalOpen(false)} />}
    </DataVersion.Provider>
  );
}
