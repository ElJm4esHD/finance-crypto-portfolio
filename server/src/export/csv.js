import { localDateTime } from '../lib/dates.js';

// Machine-friendly numbers: dot decimal, no grouping, no exponent.
const num = (n, maxDecimals = 8) =>
  n == null ? '' : Number(n).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: maxDecimals });
const money = (n) => num(n, 2);
const pct = (n) => num(n, 2);

function cell(value) {
  if (value == null) return '';
  let s = String(value);
  if (/^[=+@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheets from running user text as formulas
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Several titled tables in one file: title row, header row, data rows, blank line.
// The BOM makes Excel read the accents correctly.
function toCsv(blocks) {
  const lines = [];
  for (const { title, header, rows } of blocks) {
    lines.push(cell(title), header.map(cell).join(','), ...rows.map((r) => r.map(cell).join(',')), '');
  }
  return `﻿${lines.join('\r\n')}`;
}

function sourceLabel({ name, mock, error }) {
  if (error) return `Sin precios (${error})`;
  return mock ? 'Simulados: NO son precios reales de mercado' : name;
}

export async function cryptoCsv(crypto) {
  const h = await crypto.getHoldings();
  return toCsv([
    {
      title: 'Exportación cripto',
      header: ['dato', 'valor'],
      rows: [
        ['exportado', localDateTime()],
        ['precios', sourceLabel(h.priceSource)],
        ['valor_total_usdt', money(h.total)],
        ['variacion_dia_usdt', money(h.dayChange)],
        ['variacion_dia_pct', pct(h.dayChangePct)],
        ['objetivo_usdt', money(h.goal)],
        ['progreso_objetivo_pct', h.goal ? pct((h.total / h.goal) * 100) : ''],
      ],
    },
    {
      title: 'Cartera',
      header: ['moneda', 'cantidad', 'precio_usdt', 'valor_usdt', 'peso_pct', 'variacion_dia_pct'],
      rows: h.holdings.map((x) => [x.asset, num(x.amount), num(x.price), money(x.value), pct(x.weight), pct(x.dayChangePct)]),
    },
    {
      title: 'Historial de intercambios',
      header: ['fecha', 'entrega_moneda', 'entrega_cantidad', 'recibe_moneda', 'recibe_cantidad', 'comision_moneda', 'comision_cantidad'],
      rows: crypto.listExchanges().map((e) => [
        e.executed_at.replace('T', ' '), e.from_asset, num(e.from_amount), e.to_asset, num(e.to_amount),
        e.fee_asset ?? '', e.fee_amount > 0 ? num(e.fee_amount) : '',
      ]),
    },
  ]);
}

export async function cedearsCsv(cedears) {
  const p = await cedears.getPortfolio();
  const currencies = Object.keys(p.totals).filter((c) => p.totals[c].used);
  return toCsv([
    {
      title: 'Exportación CEDEARs / ETF',
      header: ['dato', 'valor'],
      rows: [
        ['exportado', localDateTime()],
        ['precios', sourceLabel(p.priceSource)],
        ['nota', 'Cada moneda se muestra por separado, sin tipo de cambio. El peso es dentro de su moneda.'],
      ],
    },
    {
      title: 'Totales por moneda',
      header: ['moneda', 'posiciones', 'disponible', 'total', 'variacion_dia', 'variacion_dia_pct'],
      rows: currencies.map((c) => {
        const t = p.totals[c];
        return [c, money(t.positions), money(t.cash), money(t.total), money(t.dayChange), pct(t.dayChangePct)];
      }),
    },
    {
      title: 'Cartera',
      header: ['ticker', 'moneda', 'cantidad', 'precio_promedio', 'precio_actual', 'valor', 'rendimiento', 'rendimiento_pct', 'variacion_dia_pct', 'peso_en_su_moneda_pct'],
      rows: p.positions.map((x) => [
        x.ticker, x.currency, num(x.quantity), num(x.avgPrice), num(x.price), money(x.value ?? x.cost),
        money(x.pnl), pct(x.pnlPct), pct(x.dayChangePct), pct(x.weight),
      ]),
    },
    {
      title: 'Historial de compras y ventas',
      header: ['fecha', 'tipo', 'ticker', 'cantidad', 'precio', 'moneda', 'comision', 'total'],
      rows: cedears.listOperations().map((o) => {
        const gross = o.quantity * o.price;
        const total = o.type === 'buy' ? gross + o.commission : gross - o.commission;
        return [o.date, o.type === 'buy' ? 'compra' : 'venta', o.ticker, num(o.quantity), num(o.price), o.currency, money(o.commission), money(total)];
      }),
    },
    {
      title: 'Historial de depósitos y retiros',
      header: ['fecha', 'tipo', 'moneda', 'monto', 'nota'],
      rows: cedears.listCashMovements().map((m) => [m.date, m.type === 'deposit' ? 'depósito' : 'retiro', m.currency, money(m.amount), m.note ?? '']),
    },
  ]);
}
