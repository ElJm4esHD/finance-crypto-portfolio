import { useState } from 'preact/hooks';
import { fmtAmount, fmtMoney, fmtPct, fmtPrice } from '../format.js';
import { PHONE_QUERY, useApi, useMediaQuery, useStoredState } from '../hooks.js';
import { ChangeChip, EmptyState, ErrorMessage, Icon, Loading, PriceNotice, SignedChange } from '../components/ui.jsx';
import { convert, CurrencySelect, MepNote } from '../components/money.jsx';
import { AssetList } from '../components/AssetList.jsx';
import { GrowthPanel } from '../components/GrowthPanel.jsx';

export const CEDEAR_CURRENCY_KEY = 'currency:cedears';
const CURRENCIES = ['ARS', 'USD'];

// Headline figures in one currency: the whole portfolio converted with the
// dólar MEP. Without a rate each currency in use gets its own figure.
function figuresOf(totals, currency, rate) {
  const native = (c) => ({ currency: c, ...totals[c] });
  if (!rate) {
    const used = CURRENCIES.filter((c) => totals[c].used);
    return (used.length ? used : CURRENCIES).map(native);
  }
  const sum = (key) => CURRENCIES.reduce((s, c) => s + convert(totals[c][key] ?? 0, c, currency, rate), 0);
  const total = sum('total');
  const invested = sum('invested');
  const withDay = CURRENCIES.filter((c) => totals[c].dayChange !== null);
  const dayChange = withDay.length ? withDay.reduce((s, c) => s + convert(totals[c].dayChange, c, currency, rate), 0) : null;
  const previous = dayChange === null ? null : total - dayChange;
  return [
    {
      currency,
      total,
      invested,
      performance: total - invested,
      performancePct: invested > 0 ? ((total - invested) / invested) * 100 : null,
      dayChange,
      dayChangePct: previous > 0 ? (dayChange / previous) * 100 : null,
    },
  ];
}

export function CedearPortfolio({ onNewOperation }) {
  const { data, error, loading } = useApi('/cedears/portfolio');
  const { data: sparks } = useApi('/cedears/sparklines');
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [picked, setPicked] = useStoredState(CEDEAR_CURRENCY_KEY, 'ARS');
  const [showClosed, setShowClosed] = useState(false);

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  const { positions, cash, totals, priceSource } = data;
  const rate = data.fx?.rate ?? null;
  const currency = picked === 'USD' ? 'USD' : 'ARS';
  const figures = figuresOf(totals, currency, rate);
  // Amounts of a position in the picked currency (its own one without a rate).
  const shownIn = (c) => (rate ? currency : c);
  const conv = (v, c) => convert(v, c, shownIn(c), rate);

  const open = positions.filter((p) => p.quantity > 0);
  const closed = positions.filter((p) => p.quantity === 0);
  const valueOf = (p) => conv(p.value ?? p.cost, p.currency);
  const openValue = open.reduce((s, p) => s + valueOf(p), 0);
  const tickers = positions.map((p) => p.ticker);
  const inBoth = (t) => tickers.filter((x) => x === t).length > 1;

  const rows = (showClosed ? [...open, ...closed] : open).map((p) => {
    const isClosed = p.quantity === 0;
    const value = valueOf(p);
    const weight = rate ? (openValue > 0 && !isClosed ? (value / openValue) * 100 : 0) : p.weight;
    return {
      key: `${p.ticker}|${p.currency}`,
      symbol: p.ticker,
      label: inBoth(p.ticker) ? `${p.ticker} · ${p.currency}` : p.ticker,
      sub: isClosed ? 'Cerrada' : `${fmtAmount(p.quantity)} · ${fmtMoney(value, shownIn(p.currency))}${p.value === null ? '*' : ''}`,
      price: isClosed ? '—' : p.price === null ? 'Sin precio' : fmtPrice(p.price, p.currency),
      dayChangePct: isClosed ? null : p.dayChangePct,
      spark: sparks?.[p.ticker],
      dimmed: isClosed,
      detail: [
        ['Cantidad', fmtAmount(p.quantity)],
        ['Precio promedio', fmtPrice(p.avgPrice, p.currency)],
        ['Precio actual', isClosed ? '—' : fmtPrice(p.price, p.currency)],
        ['Valor', isClosed ? '—' : p.value === null ? `${fmtMoney(value, shownIn(p.currency))} (a costo, sin precio)` : fmtMoney(value, shownIn(p.currency))],
        [
          'Rendimiento',
          isClosed || p.pnl === null ? '—' : <SignedChange change={conv(p.pnl, p.currency)} pct={p.pnlPct} currency={shownIn(p.currency)} />,
        ],
        [rate ? 'Peso en la cartera' : `Peso en ${p.currency}`, isClosed ? '—' : fmtPct(weight)],
      ],
    };
  });

  return (
    <div class="overview">
      <section class="card hero-card overview-hero">
        <div class="hero-top">
          <p class="hero-label">Total de la cartera</p>
          <PriceNotice source={priceSource} />
          <CurrencySelect value={currency} onChange={setPicked} disabled={!rate} />
        </div>
        <div class="hero-totals">
          {figures.map((f) => (
            <div>
              <p class="hero-value">{fmtMoney(f.total, f.currency)}</p>
              <div class="hero-meta">
                <ChangeChip pct={f.dayChangePct} dash={false} />
                {f.dayChange !== null && (
                  <span class="muted">
                    <SignedChange change={f.dayChange} currency={f.currency} /> hoy
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        {!isPhone && <GrowthPanel section="cedears" currency={currency} />}
      </section>

      <aside class="overview-aside">
        <section class="card" aria-label="Resumen">
          <div class="stats">
            {figures.map((f) => (
              <>
                <div class="stat">
                  <span class="stat-label">Invertido{figures.length > 1 && ` en ${f.currency}`}</span>
                  <span class="stat-value">{fmtMoney(f.invested, f.currency)}</span>
                </div>
                <div class="stat">
                  <span class="stat-label">Rendimiento{figures.length > 1 && ` en ${f.currency}`}</span>
                  <span class="stat-value">
                    <SignedChange change={f.performance} currency={f.currency} />
                    {f.performancePct !== null && (
                      <span class={`sub change-value ${f.performance >= 0 ? 'up' : 'down'}`}>{fmtPct(f.performancePct, { signed: true })}</span>
                    )}
                  </span>
                </div>
              </>
            ))}
            {/* Real money in each currency, never converted. */}
            <div class="stat-group">
              <p class="stat-group-title">Disponible</p>
              <div class="stat">
                <span class="stat-label">Dólares</span>
                <span class="stat-value">{fmtMoney(cash.USD, 'USD')}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Pesos</span>
                <span class="stat-value">{fmtMoney(cash.ARS, 'ARS')}</span>
              </div>
            </div>
            <MepNote fx={data.fx} />
          </div>
        </section>
      </aside>

      <section class="card overview-list">
        <div class="card-head">
          <h2 class="card-title">Activos</h2>
        </div>
        {positions.length === 0 ? (
          <EmptyState
            title="Todavía no tenés posiciones"
            action={
              <button type="button" class="btn btn-primary" onClick={onNewOperation}>
                <Icon name="plus" /> Nueva operación
              </button>
            }
          >
            Primero cargá un depósito en USD o ARS (Nueva operación → Depósito) y después registrá tus compras.
          </EmptyState>
        ) : (
          <>
            <AssetList kind="cedears" rows={rows} />
            {closed.length > 0 && (
              <button type="button" class="link-btn list-toggle" onClick={() => setShowClosed(!showClosed)}>
                {showClosed ? 'Ocultar posiciones cerradas' : `Ver posiciones cerradas (${closed.length})`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
