import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { fmtAmount, fmtMoney, fmtPct, fmtPrice, parseNumber, toInputValue } from '../format.js';
import { PHONE_QUERY, useApi, useMediaQuery, useMutation, useStoredState } from '../hooks.js';
import { ChangeChip, EmptyState, ErrorMessage, Field, Icon, Loading, Modal, PriceNotice, SignedChange } from '../components/ui.jsx';
import { convert, CurrencySelect, MepNote } from '../components/money.jsx';
import { AssetList } from '../components/AssetList.jsx';
import { GrowthPanel } from '../components/GrowthPanel.jsx';
import { GoalModal, GoalProgress } from './GoalProgress.jsx';

// Crypto is valued in USDT (1:1 with USD); ARS uses the dólar MEP of the day.
export const CRYPTO_CURRENCY_KEY = 'currency:crypto';
export const cryptoUnit = (currency) => (currency === 'USD' ? 'USDT' : 'ARS');

export function CryptoHoldings() {
  const { data, error, loading } = useApi('/crypto/holdings');
  const { data: sparks } = useApi('/crypto/sparklines');
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [picked, setPicked] = useStoredState(CRYPTO_CURRENCY_KEY, 'USD');
  const [editing, setEditing] = useState(null); // { asset, amount } | { asset: '' } for a new one
  const [modal, setModal] = useState(null); // 'opening' | 'goal'
  const [showEmpty, setShowEmpty] = useState(false);

  if (loading) return <Loading />;
  if (!data) return <ErrorMessage>{error}</ErrorMessage>;

  const rate = data.fx?.rate ?? null;
  const currency = rate && picked === 'ARS' ? 'ARS' : 'USD';
  const unit = cryptoUnit(currency);
  const conv = (v) => convert(v, 'USDT', currency, rate);

  const withBalance = data.holdings.filter((h) => h.amount > 0);
  const empty = data.holdings.filter((h) => h.amount === 0);
  const usdt = data.holdings.find((h) => h.asset === 'USDT')?.amount ?? 0;

  const rows = (showEmpty ? [...withBalance, ...empty] : withBalance).map((h) => ({
    key: h.asset,
    symbol: h.asset,
    sub: `${fmtAmount(h.amount)} · ${h.value === null ? (h.amount > 0 ? 'sin precio' : 'sin saldo') : fmtMoney(conv(h.value), unit)}`,
    price: h.amount > 0 ? fmtPrice(conv(h.price), unit) : '—',
    dayChangePct: h.amount > 0 ? h.dayChangePct : null,
    spark: h.asset === 'USDT' ? [1, 1] : sparks?.[h.asset],
    dimmed: h.amount === 0,
    detail: [
      ['Cantidad', fmtAmount(h.amount)],
      ['Precio', h.amount > 0 ? fmtPrice(conv(h.price), unit) : '—'],
      ['Valor', h.value === null ? '—' : fmtMoney(conv(h.value), unit)],
      ['Peso', fmtPct(h.weight)],
      ['Hoy', h.dayChangePct === null ? '—' : fmtPct(h.dayChangePct, { signed: true, digits: 2 })],
    ],
    actions: (
      <button type="button" class="btn btn-secondary btn-sm" onClick={() => setEditing(h)}>
        <Icon name="edit" /> Corregir saldo
      </button>
    ),
  }));

  return (
    <div class="overview">
      <section class="card hero-card overview-hero">
        <div class="hero-top">
          <p class="hero-label">Valor total</p>
          <PriceNotice source={data.priceSource} />
          <CurrencySelect value={currency} onChange={setPicked} disabled={!rate} />
        </div>
        <p class="hero-value">{fmtMoney(conv(data.total), unit)}</p>
        <div class="hero-meta">
          <ChangeChip pct={data.dayChangePct} dash={false} />
          {data.dayChange !== null && (
            <span class="muted">
              <SignedChange change={conv(data.dayChange)} currency={unit} /> hoy
            </span>
          )}
        </div>
        {!isPhone && <GrowthPanel section="crypto" currency={currency} />}
      </section>

      <aside class="overview-aside">
        <section class="card" aria-label="Resumen">
          <div class="stats">
            <div class="stat">
              <span class="stat-label">
                Invertido
                <button type="button" class="icon-btn sm" title="Ajustar lo invertido antes de registrar aportes" aria-label="Ajustar invertido" onClick={() => setModal('opening')}>
                  <Icon name="edit" />
                </button>
              </span>
              <span class="stat-value">{fmtMoney(conv(data.invested), unit)}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Rendimiento</span>
              <span class="stat-value">
                <SignedChange change={conv(data.performance)} currency={unit} />
                {data.performancePct !== null && (
                  <span class={`sub change-value ${data.performance >= 0 ? 'up' : 'down'}`}>{fmtPct(data.performancePct, { signed: true })}</span>
                )}
              </span>
            </div>
            <div class="stat">
              <span class="stat-label">Disponible</span>
              <span class="stat-value">{fmtMoney(usdt, 'USDT')}</span>
            </div>
            <div class="stat-group">
              {data.goal ? (
                <>
                  <div class="stat">
                    <span class="stat-label">Objetivo</span>
                    <button type="button" class="link-btn" style={{ padding: 0 }} onClick={() => setModal('goal')}>
                      Cambiar
                    </button>
                  </div>
                  <GoalProgress total={data.total} goal={data.goal} compact />
                </>
              ) : (
                <button type="button" class="link-btn" style={{ padding: 0 }} onClick={() => setModal('goal')}>
                  Definir un objetivo en USDT
                </button>
              )}
            </div>
            <MepNote fx={data.fx} />
          </div>
        </section>
      </aside>

      <section class="card overview-list">
        <div class="card-head">
          <h2 class="card-title">Activos</h2>
          <button type="button" class="btn btn-secondary btn-sm" onClick={() => setEditing({ asset: '' })}>
            <Icon name="plus" /> Agregar moneda
          </button>
        </div>
        {data.holdings.length === 0 ? (
          <EmptyState title="Todavía no cargaste saldos">
            Registrá lo que tenés con "Nuevo movimiento → Aporte" (cuenta como plata invertida) o agregá la moneda con su saldo actual.
          </EmptyState>
        ) : (
          <>
            <AssetList kind="crypto" rows={rows} />
            {empty.length > 0 && (
              <button type="button" class="link-btn list-toggle" onClick={() => setShowEmpty(!showEmpty)}>
                {showEmpty ? 'Ocultar monedas sin saldo' : `Mostrar monedas sin saldo (${empty.length})`}
              </button>
            )}
          </>
        )}
      </section>

      {editing && <HoldingModal holding={editing} onClose={() => setEditing(null)} />}
      {modal === 'opening' && <OpeningModal onClose={() => setModal(null)} />}
      {modal === 'goal' && <GoalModal goal={data.goal} onClose={() => setModal(null)} />}
    </div>
  );
}

// Corrects a balance by hand. Not a contribution: it does not change what
// was invested (that is "Nuevo movimiento → Aporte / Retiro").
function HoldingModal({ holding, onClose }) {
  const isNew = !holding.asset;
  const [asset, setAsset] = useState(holding.asset);
  const [amount, setAmount] = useState(isNew ? '' : toInputValue(holding.amount));
  const { run, busy, error, setError } = useMutation();

  async function save(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (n === null || Number.isNaN(n)) return setError('Ingresá una cantidad válida.');
    const { ok } = await run(() => api.put('/crypto/holdings', { asset, amount: n }));
    if (ok) onClose();
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar ${holding.asset} de la lista? El historial no se borra.`)) return;
    const { ok } = await run(() => api.del(`/crypto/holdings/${encodeURIComponent(holding.asset)}`));
    if (ok) onClose();
  }

  return (
    <Modal title={isNew ? 'Agregar moneda' : `Corregir saldo de ${holding.asset}`} onClose={onClose}>
      <form onSubmit={save} class="form">
        {isNew && (
          <Field label="Moneda" hint="El ticker, por ejemplo BTC, ETH o USDT.">
            <input value={asset} onInput={(e) => setAsset(e.currentTarget.value.toUpperCase())} autofocus required maxLength={20} autocomplete="off" />
          </Field>
        )}
        <Field label="Cantidad que tenés hoy" hint="Es una corrección: no cuenta como plata invertida. Para registrar plata nueva usá Nuevo movimiento → Aporte.">
          <input value={amount} onInput={(e) => setAmount(e.currentTarget.value)} inputMode="decimal" autocomplete="off" required autofocus={!isNew} placeholder="0,00" />
        </Field>
        <ErrorMessage>{error}</ErrorMessage>
        <div class="form-actions">
          {!isNew && (
            <button type="button" class="btn btn-danger-text" onClick={remove} disabled={busy}>
              Eliminar moneda
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

// What was invested before contributions were recorded in the app.
function OpeningModal({ onClose }) {
  const { data } = useApi('/crypto/invested-opening');
  const [value, setValue] = useState(null);
  const { run, busy, error, setError } = useMutation();
  const shown = value ?? (data ? toInputValue(data.amount) : '');

  async function save(e) {
    e.preventDefault();
    const n = parseNumber(shown);
    if (n === null || Number.isNaN(n) || n < 0) return setError('Ingresá un monto válido.');
    const { ok } = await run(() => api.put('/crypto/invested-opening', { amount: n }));
    if (ok) onClose();
  }

  return (
    <Modal title="Invertido inicial" onClose={onClose}>
      <form onSubmit={save} class="form">
        <p class="form-note">
          Lo que habías puesto en cripto antes de registrar aportes en la app. Los aportes y retiros que cargues se suman a este monto; el
          rendimiento es el valor actual menos el total invertido.
        </p>
        <Field label="Monto en USDT">
          <input value={shown} onInput={(e) => setValue(e.currentTarget.value)} inputMode="decimal" placeholder="0,00" autocomplete="off" autofocus required />
        </Field>
        <ErrorMessage>{error}</ErrorMessage>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" class="btn btn-primary" disabled={busy}>
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}
